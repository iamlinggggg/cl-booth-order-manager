(in-package :cl-booth-library-manager.db)

;;; ---------------------------------------------------------------------------
;;; Connection management
;;; ---------------------------------------------------------------------------

(defvar *db* nil)
(defvar *db-lock* (bordeaux-threads:make-lock "db-lock"))

(defmacro with-db (&body body)
  `(bordeaux-threads:with-lock-held (*db-lock*)
     ,@body))

(defun get-app-data-dir ()
  "アプリケーションデータディレクトリを返す (プラットフォーム対応)"
  (let ((base
          #+windows
          (or (uiop:getenv "APPDATA")
              (uiop:native-namestring (user-homedir-pathname)))
          #+darwin
          (uiop:native-namestring
           (merge-pathnames "Library/Application Support/"
                            (user-homedir-pathname)))
          #-(or windows darwin)
          (or (uiop:getenv "XDG_DATA_HOME")
              (uiop:native-namestring
               (merge-pathnames ".local/share/"
                                (user-homedir-pathname))))))
    (let ((dir (merge-pathnames "cl-booth-library-manager/"
                                (uiop:ensure-directory-pathname base))))
      (ensure-directories-exist dir)
      dir)))

(defun init-db (&optional path)
  "DBを初期化する。pathが省略された場合はデフォルトパスを使用"
  (let ((db-path (or path
                     (merge-pathnames "orders.db" (get-app-data-dir)))))
    (setf *db* (sqlite:connect (uiop:native-namestring db-path)))
    (create-schema)
    (format t "DB initialized: ~A~%" db-path)
    *db*))

(defun close-db ()
  (when *db*
    (sqlite:disconnect *db*)
    (setf *db* nil)))

;;; ---------------------------------------------------------------------------
;;; Schema
;;; ---------------------------------------------------------------------------

(defun create-schema ()
  (with-db
    (sqlite:execute-non-query *db*
      "PRAGMA foreign_keys = ON")
    (sqlite:execute-non-query *db*
      "CREATE TABLE IF NOT EXISTS orders (
         id              INTEGER PRIMARY KEY AUTOINCREMENT,
         booth_order_id  TEXT UNIQUE,
         item_id         TEXT,
         item_name       TEXT NOT NULL DEFAULT '',
         shop_name       TEXT DEFAULT '',
         item_url        TEXT DEFAULT '',
         thumbnail_url   TEXT DEFAULT '',
         price           INTEGER DEFAULT 0,
         currency        TEXT DEFAULT 'JPY',
         purchased_at    TEXT DEFAULT '',
         created_at      TEXT DEFAULT (datetime('now')),
         is_manual       INTEGER DEFAULT 0
       )")
    (sqlite:execute-non-query *db*
      "CREATE TABLE IF NOT EXISTS download_links (
         id         INTEGER PRIMARY KEY AUTOINCREMENT,
         order_id   INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
         label      TEXT DEFAULT '',
         url        TEXT NOT NULL,
         created_at TEXT DEFAULT (datetime('now'))
       )")
    (sqlite:execute-non-query *db*
      "CREATE TABLE IF NOT EXISTS sync_state (
         key   TEXT PRIMARY KEY,
         value TEXT NOT NULL
       )")
    (sqlite:execute-non-query *db*
      "CREATE INDEX IF NOT EXISTS idx_download_links_order_id
       ON download_links(order_id)")))

;;; ---------------------------------------------------------------------------
;;; Cookie encryption (AES-256-CTR)
;;; ---------------------------------------------------------------------------

(defvar *cookie-key* nil)

(defun cookie-key-path ()
  (merge-pathnames ".session.key" (get-app-data-dir)))

(defun ensure-cookie-key ()
  "暗号化キーをファイルから読み込む。なければ生成して保存する"
  (unless *cookie-key*
    (let ((path (cookie-key-path)))
      (setf *cookie-key*
            (if (probe-file path)
                (with-open-file (f path :element-type '(unsigned-byte 8))
                  (let ((k (make-array 32 :element-type '(unsigned-byte 8))))
                    (read-sequence k f)
                    k))
                (let ((k (ironclad:random-data 32)))
                  (with-open-file (f path
                                     :direction :output
                                     :element-type '(unsigned-byte 8)
                                     :if-does-not-exist :create)
                    (write-sequence k f))
                  k))))))

(defun encrypt-cookie-string (plaintext)
  "平文文字列をAES-256-CTRで暗号化し、hex文字列 (iv || ciphertext) を返す"
  (ensure-cookie-key)
  (let* ((plain-bytes (sb-ext:string-to-octets plaintext :external-format :utf-8))
         (iv          (ironclad:random-data 16))
         (cipher      (ironclad:make-cipher :aes
                                            :key *cookie-key*
                                            :mode :ctr
                                            :initialization-vector iv))
         (ciphertext  (copy-seq plain-bytes)))
    (ironclad:encrypt-in-place cipher ciphertext)
    (ironclad:byte-array-to-hex-string
     (concatenate '(vector (unsigned-byte 8)) iv ciphertext))))

(defun decrypt-cookie-string (hex-data)
  "hex文字列 (iv || ciphertext) をAES-256-CTRで復号し、平文文字列を返す"
  (ensure-cookie-key)
  (let* ((data       (ironclad:hex-string-to-byte-array hex-data))
         (iv         (subseq data 0 16))
         (ciphertext (subseq data 16))
         (cipher     (ironclad:make-cipher :aes
                                           :key *cookie-key*
                                           :mode :ctr
                                           :initialization-vector iv))
         (plaintext  (copy-seq ciphertext)))
    (ironclad:decrypt-in-place cipher plaintext)
    (sb-ext:octets-to-string plaintext :external-format :utf-8)))

;;; ---------------------------------------------------------------------------
;;; Auth / Cookies
;;; ---------------------------------------------------------------------------

(defun save-cookies (cookies-json)
  "Cookie JSONを暗号化してDBに保存する"
  (with-db
    (sqlite:execute-non-query *db*
      "INSERT OR REPLACE INTO sync_state (key, value) VALUES ('cookies', ?)"
      (concatenate 'string "ENC:" (encrypt-cookie-string cookies-json)))))

(defun get-cookies ()
  "保存済みCookie JSONを復号して返す。未設定の場合はnil"
  (let ((raw (with-db
               (sqlite:execute-single *db*
                 "SELECT value FROM sync_state WHERE key = 'cookies'"))))
    (when raw
      (if (and (> (length raw) 4)
               (string= (subseq raw 0 4) "ENC:"))
          ;; 暗号化済み: 復号する
          (handler-case
              (decrypt-cookie-string (subseq raw 4))
            (error (c)
              (format *error-output* "[db] Cookie decryption failed: ~A~%" c)
              nil))
          ;; レガシー平文: そのまま返すが再保存時に暗号化される
          raw))))

(defun clear-cookies ()
  (with-db
    (sqlite:execute-non-query *db*
      "DELETE FROM sync_state WHERE key = 'cookies'")))

(defun is-logged-in ()
  "Cookie が保存されているかどうか"
  (not (null (get-cookies))))

;;; ---------------------------------------------------------------------------
;;; Sync state
;;; ---------------------------------------------------------------------------

(defun get-last-synced-at ()
  "最終同期時刻をUnixタイムスタンプ(整数)で返す。未記録なら0"
  (let ((val (with-db
               (sqlite:execute-single *db*
                 "SELECT value FROM sync_state WHERE key = 'last_synced_at'"))))
    (if val (parse-integer val :junk-allowed t) 0)))

(defun set-last-synced-at (unix-timestamp)
  (with-db
    (sqlite:execute-non-query *db*
      "INSERT OR REPLACE INTO sync_state (key, value) VALUES ('last_synced_at', ?)"
      (format nil "~A" unix-timestamp))))

;;; ---------------------------------------------------------------------------
;;; Generic settings (sync_state テーブルを共用、キープレフィックス "setting:")
;;; ---------------------------------------------------------------------------

(defun save-setting (key value)
  "設定値を sync_state テーブルに保存する"
  (with-db
    (sqlite:execute-non-query *db*
      "INSERT OR REPLACE INTO sync_state (key, value) VALUES (?, ?)"
      (concatenate 'string "setting:" key)
      value)))

(defun get-setting (key &optional default)
  "設定値を sync_state テーブルから取得する。未設定の場合は default を返す"
  (let ((val (with-db
               (sqlite:execute-single *db*
                 "SELECT value FROM sync_state WHERE key = ?"
                 (concatenate 'string "setting:" key)))))
    (or val default)))

;;; ---------------------------------------------------------------------------
;;; Orders CRUD
;;; ---------------------------------------------------------------------------

(defun get-order-id-by-booth-id (booth-order-id)
  "booth_order_idでorderのDBのidを返す。存在しなければnil"
  (with-db
    (sqlite:execute-single *db*
      "SELECT id FROM orders WHERE booth_order_id = ?"
      booth-order-id)))

(defun get-download-urls (order-id)
  "指定注文のダウンロードURL一覧を文字列リストで返す"
  (with-db
    (mapcar #'car
     (sqlite:execute-to-list *db*
       "SELECT url FROM download_links WHERE order_id = ? ORDER BY id"
       order-id))))

(defun replace-download-links (order-id links)
  "既存のダウンロードリンクを全削除して links で差し替える"
  (with-db
    (sqlite:execute-non-query *db*
      "DELETE FROM download_links WHERE order_id = ?" order-id))
  (insert-download-links order-id links))

(defun upsert-order (booth-order-id item-id item-name shop-name
                     item-url thumbnail-url price currency purchased-at)
  "注文をINSERT OR IGNORE し、そのIDを返す"
  (with-db
    (sqlite:execute-non-query *db*
      "INSERT OR IGNORE INTO orders
         (booth_order_id, item_id, item_name, shop_name, item_url,
          thumbnail_url, price, currency, purchased_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
      booth-order-id item-id item-name shop-name item-url
      thumbnail-url price currency purchased-at)
    (sqlite:execute-single *db*
      "SELECT id FROM orders WHERE booth_order_id = ?"
      booth-order-id)))

(defun insert-download-links (order-id links)
  "ダウンロードリンクを追加する。linksはplistのリスト (:label ... :url ...)"
  (with-db
    (dolist (link links)
      (sqlite:execute-non-query *db*
        "INSERT OR IGNORE INTO download_links (order_id, label, url) VALUES (?, ?, ?)"
        order-id
        (or (getf link :label) "")
        (getf link :url)))))

(defun get-all-orders ()
  "全注文を購入日降順で返す。各行は plist"
  (with-db
    (mapcar
     (lambda (row)
       (list :id           (nth 0 row)
             :booth-order-id (nth 1 row)
             :item-id      (nth 2 row)
             :item-name    (nth 3 row)
             :shop-name    (nth 4 row)
             :item-url     (nth 5 row)
             :thumbnail-url (nth 6 row)
             :price        (nth 7 row)
             :currency     (nth 8 row)
             :purchased-at (nth 9 row)
             :is-manual    (= 1 (or (nth 10 row) 0))
             :download-count (nth 11 row)
             :download-labels (or (nth 12 row) "")))
     (sqlite:execute-to-list *db*
       "SELECT o.id, o.booth_order_id, o.item_id, o.item_name, o.shop_name,
               o.item_url, o.thumbnail_url, o.price, o.currency,
               o.purchased_at, o.is_manual,
               COUNT(d.id) AS download_count,
               GROUP_CONCAT(d.label, ' ') AS download_labels
        FROM orders o
        LEFT JOIN download_links d ON d.order_id = o.id
        GROUP BY o.id
        ORDER BY o.purchased_at DESC, o.id DESC"))))

(defun get-order-downloads (order-id)
  "指定注文のダウンロードリンク一覧を返す"
  (with-db
    (mapcar
     (lambda (row)
       (list :id    (nth 0 row)
             :label (nth 1 row)
             :url   (nth 2 row)))
     (sqlite:execute-to-list *db*
       "SELECT id, label, url FROM download_links WHERE order_id = ? ORDER BY id"
       order-id))))

(defun add-manual-order (item-name shop-name item-url thumbnail-url
                         price currency download-links)
  "手動登録。download-linksはplistのリスト (:label ... :url ...)"
  (let* ((pseudo-id (format nil "manual-~A" (get-universal-time)))
         (order-id (upsert-order pseudo-id nil item-name shop-name
                                 item-url thumbnail-url price currency
                                 (current-date-string))))
    (with-db
      (sqlite:execute-non-query *db*
        "UPDATE orders SET is_manual = 1 WHERE id = ?" order-id))
    (insert-download-links order-id download-links)
    order-id))

(defun update-manual-order (order-id item-name shop-name item-url
                            thumbnail-url price currency download-links)
  "手動登録済み注文を更新する。download-linksは (:label ... :url ...) のリスト"
  (with-db
    (sqlite:execute-non-query *db*
      "UPDATE orders
       SET item_name=?, shop_name=?, item_url=?, thumbnail_url=?, price=?, currency=?
       WHERE id=? AND is_manual=1"
      item-name shop-name item-url thumbnail-url price currency order-id)
    (sqlite:execute-non-query *db*
      "DELETE FROM download_links WHERE order_id=?" order-id))
  (insert-download-links order-id download-links))

(defun delete-order (order-id)
  (with-db
    (sqlite:execute-non-query *db*
      "DELETE FROM orders WHERE id = ?" order-id)))

;;; ---------------------------------------------------------------------------
;;; Thumbnail cache
;;; ---------------------------------------------------------------------------

(defun thumbnail-cache-dir ()
  "サムネイルキャッシュディレクトリを返す (なければ作成)"
  (let ((dir (merge-pathnames "thumbnails/" (get-app-data-dir))))
    (ensure-directories-exist dir)
    dir))

(defun thumbnail-cache-path (order-id)
  "指定orderのサムネイルキャッシュファイルパスを返す"
  (merge-pathnames (format nil "~A" order-id) (thumbnail-cache-dir)))

(defun thumbnail-cached-p (order-id)
  "ローカルキャッシュが存在するか"
  (not (null (probe-file (thumbnail-cache-path order-id)))))

(defun save-thumbnail (order-id bytes)
  "画像バイト列をキャッシュファイルとして保存する"
  (let ((path (thumbnail-cache-path order-id)))
    (with-open-file (f path
                       :direction :output
                       :element-type '(unsigned-byte 8)
                       :if-exists :supersede
                       :if-does-not-exist :create)
      (write-sequence bytes f))
    path))

(defun detect-image-content-type (path)
  "ファイル先頭バイトからContent-Typeを推定する"
  (handler-case
      (with-open-file (f path :element-type '(unsigned-byte 8))
        (let ((hdr (make-array 8 :element-type '(unsigned-byte 8) :initial-element 0)))
          (read-sequence hdr f)
          (cond
            ;; JPEG: FF D8
            ((and (= (aref hdr 0) #xFF) (= (aref hdr 1) #xD8))
             "image/jpeg")
            ;; PNG: 89 50 4E 47
            ((and (= (aref hdr 0) #x89) (= (aref hdr 1) #x50)
                  (= (aref hdr 2) #x4E) (= (aref hdr 3) #x47))
             "image/png")
            ;; GIF: 47 49 46
            ((and (= (aref hdr 0) #x47) (= (aref hdr 1) #x49)
                  (= (aref hdr 2) #x46))
             "image/gif")
            ;; WebP: RIFF....
            ((and (= (aref hdr 0) #x52) (= (aref hdr 1) #x49)
                  (= (aref hdr 2) #x46) (= (aref hdr 3) #x46))
             "image/webp")
            (t "image/jpeg"))))
    (error () "image/jpeg")))

(defun get-thumbnail-url (order-id)
  "指定orderのthumbnail_urlを返す"
  (with-db
    (sqlite:execute-single *db*
      "SELECT thumbnail_url FROM orders WHERE id = ?"
      order-id)))

(defun get-orders-needing-thumbnail ()
  "thumbnail_urlがあってキャッシュが未作成のorder行を (id thumbnail-url) リストで返す"
  (let ((rows (with-db
                (sqlite:execute-to-list *db*
                  "SELECT id, thumbnail_url FROM orders WHERE thumbnail_url != ''"))))
    (remove-if (lambda (row) (thumbnail-cached-p (nth 0 row))) rows)))

(defun update-thumbnail-url (order-id thumbnail-url)
  "既存orderのthumbnail_urlをDBで更新する"
  (with-db
    (sqlite:execute-non-query *db*
      "UPDATE orders SET thumbnail_url = ? WHERE id = ?"
      thumbnail-url order-id)))

(defun delete-thumbnail-cache (order-id)
  "ローカルサムネイルキャッシュファイルを削除する"
  (let ((path (thumbnail-cache-path order-id)))
    (when (probe-file path)
      (delete-file path))))

;;; ---------------------------------------------------------------------------
;;; Helpers
;;; ---------------------------------------------------------------------------

(defun current-date-string ()
  (multiple-value-bind (sec min hr day mon yr)
      (decode-universal-time (get-universal-time))
    (declare (ignore sec min hr))
    (format nil "~4,'0D-~2,'0D-~2,'0D" yr mon day)))
