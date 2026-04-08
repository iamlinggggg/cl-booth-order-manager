(in-package :cl-booth-library-manager.scheduler)

;;; ---------------------------------------------------------------------------
;;; State
;;; ---------------------------------------------------------------------------

(defvar *running* nil "スケジューラー動作フラグ")
(defvar *thread* nil "スケジューラースレッド")
(defvar *sync-lock* (bordeaux-threads:make-lock "sync-lock") "同時スクレイプ防止")
(defvar *is-syncing* nil "現在スクレイピング中かどうか")
(defvar *last-synced-at* 0 "最終差分同期Unixタイムスタンプ (メモリキャッシュ)")
(defvar *last-full-synced-at* 0 "最終全件同期Unixタイムスタンプ (メモリキャッシュ)")
(defvar *sync-fn* nil "スクレイピングを実行するコールバック関数")
(defvar *sync-progress* nil "同期進捗 plist: (:section :page :items-fetched)")
(defvar *sync-mode* nil "現在の同期モード: :differential または :full")
(defvar *auto-sync-enabled* t "自動同期有効フラグ")
(defvar *sync-interval-hours* 1 "差分自動同期間隔（時間）: 1~6")
(defvar *full-sync-interval-hours* 24 "全件自動同期間隔（時間）: 6~168")

(defconstant +min-interval-seconds+ (* 60 60) "手動・自動同期共通の最小間隔: 1時間")

;;; ---------------------------------------------------------------------------
;;; Helpers
;;; ---------------------------------------------------------------------------

(defun unix-now ()
  "現在時刻をUnixタイムスタンプで返す"
  (- (get-universal-time) 2208988800))

(defun seconds-since-last-sync ()
  (- (unix-now) *last-synced-at*))

(defun seconds-since-last-full-sync ()
  (- (unix-now) *last-full-synced-at*))

(defun auto-sync-interval-seconds ()
  "設定された差分自動同期間隔を秒で返す"
  (* *sync-interval-hours* 3600))

(defun full-sync-interval-seconds ()
  "設定された全件自動同期間隔を秒で返す"
  (* *full-sync-interval-hours* 3600))

(defun full-sync-due-p ()
  "全件同期が必要かどうか: 自動同期有効 かつ 設定間隔以上経過 かつ ログイン済み かつ 現在同期中でない"
  (and *auto-sync-enabled*
       (not *is-syncing*)
       (cl-booth-library-manager.db:is-logged-in)
       (>= (seconds-since-last-full-sync) (full-sync-interval-seconds))))

(defun can-sync-p ()
  "差分同期可能かどうか: 自動同期有効 かつ 設定間隔以上経過 かつ ログイン済み かつ 現在同期中でない"
  (and *auto-sync-enabled*
       (not *is-syncing*)
       (cl-booth-library-manager.db:is-logged-in)
       (>= (seconds-since-last-sync) (auto-sync-interval-seconds))))

(defun make-differential-stop-predicate ()
  "差分同期用の打ち切り判定関数を生成する。
   ページ内の全アイテムがDBに存在しDLリンクが一致していれば打ち切り"
  (lambda (page-orders)
    (every (lambda (order)
             (every (lambda (item)
                      (let* ((booth-order-id
                               (format nil "~A-~A"
                                       (getf order :order-id)
                                       (or (getf item :item-id) "0")))
                             (existing-id
                               (cl-booth-library-manager.db:get-order-id-by-booth-id
                                booth-order-id)))
                        (and existing-id
                             (equal
                              (sort (mapcar (lambda (l) (getf l :url))
                                           (getf item :downloads))
                                    #'string<)
                              (sort (cl-booth-library-manager.db:get-download-urls existing-id)
                                    #'string<)))))
                    (getf order :items)))
           page-orders)))

;;; ---------------------------------------------------------------------------
;;; Core sync
;;; ---------------------------------------------------------------------------

(defun do-sync (&key force (mode :differential))
  "スクレイピングを実行してDBに保存する。
   force: trueなら間隔チェックを無視
   mode: :differential (差分同期、既知アイテムで打ち切り) または :full (全件同期)"
  (unless (or force
              (ecase mode
                (:full         (full-sync-due-p))
                (:differential (can-sync-p))))
    (format t "[scheduler] Sync skipped (mode=~A, last sync ~A seconds ago)~%"
            mode (seconds-since-last-sync))
    (return-from do-sync :skipped))

  (bordeaux-threads:with-lock-held (*sync-lock*)
    (setf *is-syncing* t
          *sync-mode*  mode)
    (unwind-protect
         (handler-case
             (let ((cookies (cl-booth-library-manager.db:get-cookies)))
               (unless cookies
                 (format t "[scheduler] No cookies, skipping sync~%")
                 (return-from do-sync :no-auth))

               (format t "[scheduler] Starting ~A sync at ~A~%" mode (unix-now))
               (setf *sync-progress* (list :section "library" :page 1 :items-fetched 0))
               (unwind-protect
                    (let ((orders (cl-booth-library-manager.scraper:fetch-orders
                                   cookies
                                   :progress-callback
                                   (lambda (section page items-fetched)
                                     (setf *sync-progress*
                                           (list :section      section
                                                 :page         page
                                                 :items-fetched items-fetched)))
                                   :stop-predicate
                                   (when (eq mode :differential)
                                     (make-differential-stop-predicate)))))
                      ;; 各注文をDBに保存
                      (let ((new-count 0) (updated-count 0) (skipped-count 0))
                        (dolist (order orders)
                          (dolist (item (getf order :items))
                            (let* ((booth-order-id
                                     (format nil "~A-~A"
                                             (getf order :order-id)
                                             (or (getf item :item-id) "0")))
                                   (existing-id
                                     (cl-booth-library-manager.db:get-order-id-by-booth-id
                                      booth-order-id)))
                              (if existing-id
                                  ;; 既存アイテム: DLリンクとサムネイルURLを確認して必要なら更新
                                  (let* ((new-links (getf item :downloads))
                                         (new-urls  (sort (mapcar (lambda (l) (getf l :url)) new-links)
                                                          #'string<))
                                         (old-urls  (sort (cl-booth-library-manager.db:get-download-urls
                                                           existing-id)
                                                          #'string<))
                                         (new-thumb (or (getf item :thumb-url) ""))
                                         (old-thumb (or (cl-booth-library-manager.db:get-thumbnail-url
                                                         existing-id) "")))
                                    ;; DLリンク更新
                                    (if (equal new-urls old-urls)
                                        (incf skipped-count)
                                        (progn
                                          (cl-booth-library-manager.db:replace-download-links
                                           existing-id new-links)
                                          (incf updated-count)))
                                    ;; サムネイルURL変化 → DB更新 + キャッシュ無効化
                                    (when (and (> (length new-thumb) 0)
                                               (not (string= new-thumb old-thumb)))
                                      (format t "[scheduler] Thumbnail URL changed: ~A~%"
                                              booth-order-id)
                                      (cl-booth-library-manager.db:update-thumbnail-url
                                       existing-id new-thumb)
                                      (cl-booth-library-manager.db:delete-thumbnail-cache
                                       existing-id)))
                                  ;; 新規アイテム: 挿入
                                  (let ((order-id
                                          (cl-booth-library-manager.db:upsert-order
                                           booth-order-id
                                           (getf item :item-id)
                                           (getf item :item-name)
                                           (getf item :shop-name)
                                           (getf item :item-url)
                                           (getf item :thumb-url)
                                           (parse-price (getf item :price))
                                           "JPY"
                                           (getf order :purchased-at))))
                                    (cl-booth-library-manager.db:insert-download-links
                                     order-id
                                     (getf item :downloads))
                                    (incf new-count))))))
                        (format t "[scheduler] Sync DB update: ~A new, ~A dl-updated, ~A skipped~%"
                                new-count updated-count skipped-count))

                      ;; サムネイルキャッシュ (バックグラウンドで実行)
                      (let ((needs (cl-booth-library-manager.db:get-orders-needing-thumbnail)))
                        (when needs
                          (bordeaux-threads:make-thread
                           (lambda ()
                             (format t "[scheduler] Caching ~A thumbnails...~%" (length needs))
                             (dolist (row needs)
                               (let ((order-id (nth 0 row))
                                     (url      (nth 1 row)))
                                 (handler-case
                                     (let ((data (cl-booth-library-manager.scraper:download-image url)))
                                       (when data
                                         (cl-booth-library-manager.db:save-thumbnail order-id data)))
                                   (error (c)
                                     (format *error-output*
                                             "[scheduler] Thumbnail cache failed ~A: ~A~%"
                                             order-id c)))
                                 (sleep 0.3)))
                             (format t "[scheduler] Thumbnail caching done~%"))
                           :name "booth-thumbnail-cache")))

                      ;; 最終同期時刻を記録
                      (let ((now (unix-now)))
                        (setf *last-synced-at* now)
                        (cl-booth-library-manager.db:set-last-synced-at now)
                        (when (eq mode :full)
                          (setf *last-full-synced-at* now)
                          (cl-booth-library-manager.db:save-setting
                           "last-full-synced-at" (format nil "~A" now))))

                      (format t "[scheduler] ~A sync complete. ~A orders processed~%"
                              mode (length orders))
                      :success)
                 ;; メモリ上のCookieデータをゼロクリア
                 (fill cookies #\Nul)
                 (setf *sync-progress* nil)))
           (cl-booth-library-manager.scraper:cookie-expired-error (c)
             (format *error-output* "[scheduler] Cookie expired: ~A~%" c)
             (cl-booth-library-manager.db:clear-cookies)
             (format t "[scheduler] Cookies cleared. Re-login required.~%")
             :auth-expired)
           (error (c)
             (format *error-output* "[scheduler] Sync error: ~A~%" c)
             :error))
      (setf *is-syncing* nil
            *sync-mode*  nil))))

(defun parse-price (price-str)
  "価格文字列から数値を抽出する"
  (when price-str
    (let ((digits (cl-ppcre:scan-to-strings "[0-9,]+" price-str)))
      (when digits
        (let ((no-comma (cl-ppcre:regex-replace-all "," digits "")))
          (parse-integer no-comma :junk-allowed t))))))

;;; ---------------------------------------------------------------------------
;;; Scheduler loop
;;; ---------------------------------------------------------------------------

(defun scheduler-loop ()
  "バックグラウンドスレッドのメインループ"
  (loop while *running* do
    (cond
      ;; 全件同期が優先
      ((full-sync-due-p)
       (bordeaux-threads:make-thread
        (lambda () (do-sync :mode :full))
        :name "booth-full-sync-worker"))
      ;; 差分同期
      ((can-sync-p)
       (bordeaux-threads:make-thread
        (lambda () (do-sync :mode :differential))
        :name "booth-sync-worker")))
    ;; 1分ごとにチェック
    (dotimes (i 60)
      (unless *running* (return))
      (sleep 1))))

;;; ---------------------------------------------------------------------------
;;; Public API
;;; ---------------------------------------------------------------------------

(defun start (&key sync-fn)
  "スケジューラーを開始する。sync-fnは現在未使用 (内部でdo-syncを直接呼ぶ)"
  (declare (ignore sync-fn))
  ;; DBから設定と最終同期時刻を復元
  (load-settings)
  (setf *last-synced-at*
        (or (cl-booth-library-manager.db:get-last-synced-at) 0))
  (let ((full-val (cl-booth-library-manager.db:get-setting "last-full-synced-at" "0")))
    (setf *last-full-synced-at*
          (max 0 (or (parse-integer full-val :junk-allowed t) 0))))

  (format t "[scheduler] Last synced at: ~A (now: ~A, delta: ~As)~%"
          *last-synced-at* (unix-now) (seconds-since-last-sync))
  (format t "[scheduler] Last full synced at: ~A (delta: ~As)~%"
          *last-full-synced-at* (seconds-since-last-full-sync))

  ;; 初回: 1時間以上経過していれば起動5秒後に同期開始
  ;; 全件同期期限が来ていれば全件、そうでなければ差分
  (when (and (cl-booth-library-manager.db:is-logged-in)
             (>= (seconds-since-last-sync) +min-interval-seconds+))
    (let ((initial-mode (if (>= (seconds-since-last-full-sync) (full-sync-interval-seconds))
                            :full
                            :differential)))
      (bordeaux-threads:make-thread
       (lambda ()
         (sleep 5)
         (do-sync :mode initial-mode))
       :name "booth-initial-sync")))

  (setf *running* t)
  (setf *thread*
        (bordeaux-threads:make-thread #'scheduler-loop :name "booth-scheduler"))
  (format t "[scheduler] Started~%"))

(defun stop ()
  "スケジューラーを停止する"
  (setf *running* nil)
  (when (and *thread* (bordeaux-threads:thread-alive-p *thread*))
    (bordeaux-threads:join-thread *thread* :timeout 5))
  (setf *thread* nil)
  (format t "[scheduler] Stopped~%"))

(defun trigger-sync (&key (mode :differential))
  "手動同期トリガー。最低1時間の間隔を強制する。mode: :differential または :full"
  (unless (cl-booth-library-manager.db:is-logged-in)
    (error "ログインしていません"))
  (when *is-syncing*
    (error "既に同期中です"))
  (let ((elapsed (seconds-since-last-sync)))
    (when (< elapsed +min-interval-seconds+)
      (let ((remaining (- +min-interval-seconds+ elapsed)))
        (error "前回の同期から1時間経過していません (あと~A分~A秒)"
               (floor remaining 60) (mod remaining 60)))))
  (bordeaux-threads:make-thread
   (lambda () (do-sync :force t :mode mode))
   :name (if (eq mode :full) "booth-manual-full-sync" "booth-manual-sync")))

(defun get-settings ()
  "現在の同期設定を返す"
  (list :auto-sync-enabled      *auto-sync-enabled*
        :sync-interval-hours     *sync-interval-hours*
        :full-sync-interval-hours *full-sync-interval-hours*))

(defun set-auto-sync (enabled)
  "自動同期の有効/無効を設定してDBに永続化する"
  (setf *auto-sync-enabled* (not (null enabled)))
  (cl-booth-library-manager.db:save-setting
   "auto-sync" (if *auto-sync-enabled* "true" "false")))

(defun set-sync-interval (hours)
  "自動同期間隔（時間）を設定してDBに永続化する。1~6の範囲に制限"
  (let ((clamped (max 1 (min 6 (round hours)))))
    (setf *sync-interval-hours* clamped)
    (cl-booth-library-manager.db:save-setting
     "sync-interval-hours" (format nil "~A" clamped))))

(defun set-full-sync-interval (hours)
  "全件自動同期間隔（時間）を設定してDBに永続化する。6~168の範囲に制限"
  (let ((clamped (max 6 (min 168 (round hours)))))
    (setf *full-sync-interval-hours* clamped)
    (cl-booth-library-manager.db:save-setting
     "full-sync-interval-hours" (format nil "~A" clamped))))

(defun load-settings ()
  "DBから設定を読み込んでメモリに反映する"
  (let ((auto-sync      (cl-booth-library-manager.db:get-setting "auto-sync" "true"))
        (interval       (cl-booth-library-manager.db:get-setting "sync-interval-hours" "1"))
        (full-interval  (cl-booth-library-manager.db:get-setting "full-sync-interval-hours" "24")))
    (setf *auto-sync-enabled* (string= auto-sync "true"))
    (setf *sync-interval-hours*
          (max 1 (min 6 (or (parse-integer interval :junk-allowed t) 1))))
    (setf *full-sync-interval-hours*
          (max 6 (min 168 (or (parse-integer full-interval :junk-allowed t) 24))))))

(defun get-status ()
  "同期ステータスを返す"
  (let* ((interval      (auto-sync-interval-seconds))
         (full-interval (full-sync-interval-seconds))
         (next-at       (+ *last-synced-at* interval))
         (next-full-at  (+ *last-full-synced-at* full-interval))
         (now           (unix-now)))
    (list :is-syncing              *is-syncing*
          :sync-mode               *sync-mode*
          :last-synced-at          *last-synced-at*
          :last-full-synced-at     *last-full-synced-at*
          :next-sync-at            next-at
          :next-full-sync-at       next-full-at
          :seconds-until-next      (max 0 (- next-at now))
          :seconds-until-full-sync (max 0 (- next-full-at now))
          :is-logged-in            (cl-booth-library-manager.db:is-logged-in)
          :sync-progress           *sync-progress*
          :auto-sync-enabled       *auto-sync-enabled*
          :sync-interval-hours     *sync-interval-hours*
          :full-sync-interval-hours *full-sync-interval-hours*)))
