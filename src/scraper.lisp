(in-package :cl-booth-library-manager.scraper)

;;; ---------------------------------------------------------------------------
;;; Conditions
;;; ---------------------------------------------------------------------------

(define-condition cookie-expired-error (error)
  ((url :initarg :url :reader cookie-expired-url))
  (:report (lambda (c s)
             (format s "Cookie expired or unauthorized (url: ~A)"
                     (cookie-expired-url c)))))

;;; ---------------------------------------------------------------------------
;;; HTTP helpers
;;; ---------------------------------------------------------------------------

(defun app-version ()
  "アプリケーションバージョンを .asd から取得する"
  (or (ignore-errors
        (asdf:component-version (asdf:find-system :cl-booth-library-manager)))
      "0"))

(defun app-user-agent ()
  (format nil "CL-BOOTH-LIBRARY-MANAGER/~A" (app-version)))

(defun make-request-headers (cookies-json)
  "Cookie JSONリストからHTTPヘッダーalistを生成"
  (let* ((cookies (jonathan:parse cookies-json))
         (cookie-str (format nil "~{~A=~A~^; ~}"
                             (loop for c in cookies
                                   collect (getf c :|name|)
                                   collect (getf c :|value|)))))
    `(("Cookie" . ,cookie-str)
      ("User-Agent" . ,(app-user-agent))
      ("Accept" . "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8")
      ("Accept-Language" . "ja,en-US;q=0.7,en;q=0.3")
      ("Referer" . "https://accounts.booth.pm/")
      ("Sec-Fetch-Dest" . "document")
      ("Sec-Fetch-Mode" . "navigate"))))

(defun auth-failure-p (status final-uri)
  "HTTPステータスまたはリダイレクト先URLから認証失敗を判定する"
  (or (member status '(401 403))
      (let ((uri-str (quri:render-uri final-uri)))
        (or (search "sign_in"   uri-str)
            (search "/login"    uri-str)
            (search "pixiv.net" uri-str)))))

(defun fetch-html (url &optional cookies-json)
  "URLからHTMLを取得する。cookies-jsonが指定された場合は認証付きで取得"
  (let ((headers (if cookies-json
                     (make-request-headers cookies-json)
                     `(("User-Agent" . ,(app-user-agent))
                       ("Accept-Language" . "ja,en-US;q=0.7,en;q=0.3")))))
    (handler-case
        (multiple-value-bind (body status _headers final-uri)
            (dex:get url :headers headers :force-string t)
          (declare (ignore _headers))
          (when (and cookies-json (auth-failure-p status final-uri))
            (error 'cookie-expired-error :url url))
          body)
      (cookie-expired-error (c) (error c))
      (error (c)
        (error "HTTP fetch failed for ~A: ~A" url c)))))

;;; ---------------------------------------------------------------------------
;;; Parsing helpers
;;; ---------------------------------------------------------------------------

(defun node-text (node selector)
  "CSSセレクターにマッチする最初の要素のテキストを返す"
  (let ((result (lquery:$ node selector (text) (node))))
    (when (and result (stringp result))
      (string-trim '(#\Space #\Newline #\Tab #\Return) result))))

(defun node-attr (node selector attr)
  "CSSセレクターにマッチする最初の要素の属性値を返す"
  (let ((result (lquery:$ node selector (attr attr) (node))))
    (when (and result (stringp result) (> (length result) 0))
      (string-trim '(#\Space #\Newline) result))))

(defun absolutize-url (url base)
  "相対URLを絶対URLに変換する。localhost 以外の http:// は https:// に強制アップグレード"
  (cond
    ((null url) nil)
    ((uiop:string-prefix-p "https://" url) url)
    ;; localhost / 127.0.0.1 はそのまま、それ以外は https に強制
    ((uiop:string-prefix-p "http://" url)
     (if (or (search "localhost" url) (search "127.0.0.1" url))
         url
         (concatenate 'string "https://" (subseq url 7))))
    ((uiop:string-prefix-p "//" url) (concatenate 'string "https:" url))
    ((uiop:string-prefix-p "/" url)
     (cl-ppcre:regex-replace "^(https?://[^/]+).*" base (concatenate 'string "\\1" url)))
    (t url)))

(defun extract-item-id-from-url (url)
  "BOOTHの商品URLからitem IDを抽出する"
  (when url
    (cl-ppcre:register-groups-bind (id)
        ("/items/(\\d+)" url)
      id)))

;;; ---------------------------------------------------------------------------
;;; Library scraping
;;; ---------------------------------------------------------------------------

(defun parse-library-page (html base-url)
  "ライブラリページをパースしてアイテムリストと次ページURLを返す"
  (let ((doc (plump:parse html))
        (orders '()))

    (lquery:$ doc "div.bg-white"
      (filter (lambda (n) (not (null (lquery:$ n ".l-library-item-thumbnail" (node))))))
      (each (lambda (node)
              (let* ((item-a (lquery:$ node "a[href*='/items/']" (node)))
                     (item-url (when item-a (absolutize-url (plump:attribute item-a "href") base-url)))
                     ;; URLから取得できない場合は画像のパスからフォールバック抽出
                     (item-id (or (extract-item-id-from-url item-url)
                                  (let ((thumb (node-attr node "img.l-library-item-thumbnail" "src")))
                                    (when thumb
                                      (cl-ppcre:register-groups-bind (id) ("/i/(\\d+)/" thumb) id)))))

                     (name-node (lquery:$ node "a[href*='/items/'] div.font-bold" (node)))
                     (item-name-raw (if name-node (string-trim " " (plump:text name-node)) ""))

                     (shop-node (lquery:$ node "div.text-text-gray600" (node)))
                     (shop-name-raw (if shop-node (string-trim " " (plump:text shop-node)) ""))

                     (thumb-node (lquery:$ node "img.l-library-item-thumbnail" (node)))
                     (thumb-url (when thumb-node (absolutize-url (plump:attribute thumb-node "src") base-url)))

                     (downloads '()))

                ;; ダウンロードリンク抽出
                (lquery:$ node ".js-download-button[data-test='downloadable']"
                  (each (lambda (btn)
                          (let* ((href (plump:attribute btn "data-href"))
                                 (abs-href (when href (absolutize-url href base-url)))
                                 (row (plump:parent (plump:parent (plump:parent btn))))
                                 (label-node (when row (lquery:$ row ".text-14" (node))))
                                 (label (if label-node (string-trim " " (plump:text label-node)) "download")))
                            (when abs-href
                              ;; 重複登録を防止する
                              (unless (find abs-href downloads :key (lambda (x) (getf x :url)) :test #'string=)
                                (push (list :label label :url abs-href) downloads)))))))

                ;; 少なくともダウンロードリンクが存在するか、item-idが判明しているものを有効なアイテムとする
                (when (or item-id (> (length downloads) 0))
                  (let ((pseudo-order-id (format nil "lib-~A" (or item-id (get-universal-time))))
                        (item-name item-name-raw)
                        (shop-name shop-name-raw))

                    (when (and (= (length shop-name) 0) (position #\( item-name :from-end t))
                      (let ((pos (position #\( item-name :from-end t)))
                        (setf item-name (string-trim " " (subseq item-name-raw 0 pos)))
                        (setf shop-name (string-trim " )" (subseq item-name-raw (1+ pos))))))

                    (push (list :order-id     pseudo-order-id
                                :purchased-at ""
                                :items        (list
                                               (list :item-id    (or item-id "")
                                                     :item-name  item-name
                                                     :shop-name  shop-name
                                                     :item-url   (or item-url "")
                                                     :thumb-url  (or thumb-url "")
                                                     :price      "0"
                                                     :downloads  (nreverse downloads))))
                          orders)))))))

    ;; 次ページのURL
    (let ((next-url (absolutize-url
                     (node-attr doc "a[rel='next']" "href")
                     base-url)))
      (list :orders (nreverse orders)
            :next-url next-url))))

(defun fetch-orders (cookies-json &key progress-callback stop-predicate)
  "ライブラリとギフトページをスクレイピングし、注文plistのリストを返す。
   stop-predicate が指定されている場合、各ページの取得後に (funcall stop-predicate page-orders) を呼び、
   truthy が返ればそのセクションの取得を打ち切る (差分同期用)"
  (let ((all-orders '())
        (start-urls '(("library" . "https://accounts.booth.pm/library")
                      ("gifts"   . "https://accounts.booth.pm/library/gifts"))))
    (dolist (entry start-urls)
      (let ((section (car entry))
            (url     (cdr entry))
            (page    1)
            (stopped nil))
        (loop while (and url (not stopped)) do
          (format t "[scraper] Fetching: ~A~%" url)
          (when progress-callback
            (funcall progress-callback section page (length all-orders)))
          (let* ((html        (fetch-html url cookies-json))
                 (result      (parse-library-page html url))
                 (page-orders (getf result :orders)))
            (setf all-orders (append all-orders page-orders))
            ;; 差分同期: このページが全て既知なら打ち切り
            (when (and stop-predicate
                       (> (length page-orders) 0)
                       (funcall stop-predicate page-orders))
              (format t "[scraper] Stop predicate triggered at ~A page ~A~%" section page)
              (setf stopped t))
            (unless stopped
              (let ((next (getf result :next-url)))
                (if (and next (not (string= next url)))
                    (progn
                      (setf url next)
                      (incf page)
                      (sleep 2.0))
                    (setf url nil))))))))
    (format t "[scraper] Total items fetched from library: ~A~%" (length all-orders))
    all-orders))

;;; ---------------------------------------------------------------------------
;;; Image download
;;; ---------------------------------------------------------------------------

(defun download-image (url)
  "画像URLからバイト列を取得する。失敗時はnil"
  (handler-case
      (let ((data (dex:get url
                           :headers `(("User-Agent" . ,(app-user-agent)))
                           :connect-timeout 10
                           :read-timeout 15)))
        ;; dexador はバイナリContent-Typeのとき (array (unsigned-byte 8)) を返す
        ;; 文字列で返ってきた場合はlatin-1で再エンコード (バイト保存のため)
        (etypecase data
          ((array (unsigned-byte 8)) data)
          (string (sb-ext:string-to-octets data :external-format :latin-1))))
    (error (c)
      (format *error-output* "[scraper] download-image failed ~A: ~A~%" url c)
      nil)))

;;; ---------------------------------------------------------------------------
;;; Item info scraping (手動登録用)
;;; ---------------------------------------------------------------------------

(defun age-verification-page-p (doc)
  "年齢確認ページかどうかを判定する"
  (let ((body-text (plump:text doc))
        (form-action (or (node-attr doc "form" "action") "")))
    (or (search "年齢確認" body-text)
        (search "age_check" form-action)
        (not (null (lquery:$ doc "form[action*='age_check']" (node))))
        (not (null (lquery:$ doc ".age-confirmation" (node)))))))

(defun fetch-item-info (item-url &optional cookies-json)
  "商品ページのURLから商品情報を取得する。cookies-jsonが指定された場合は認証付きで取得"
  (let* ((html (fetch-html item-url cookies-json))
         (doc (plump:parse html)))
    ;; 年齢確認ページが返された場合はエラー
    (when (age-verification-page-p doc)
      (error "この商品はR18コンテンツです。ログイン後に再度お試しください。"))
    (list :item-name
          (or (node-text doc "h1.item-name, .item-name h1, h1[class*='item'], h1")
              (node-text doc "title"))
          :shop-name
          (or (node-text doc ".shop-name, .booth-name, a[class*='shop']")
              "")
          :thumbnail-url
          (or (node-attr doc ".item-primary-image img, .main-image img, .item-image img" "src")
              (node-attr doc "meta[property='og:image']" "content")
              "")
          :price
          (or (node-text doc ".price, .item-price, [class*='price']")
              "")
          :description
          (or (node-text doc ".description, .item-description, [class*='description']")
              ""))))