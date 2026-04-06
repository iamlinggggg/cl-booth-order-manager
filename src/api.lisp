(in-package :cl-booth-library-manager.api)

;;; ---------------------------------------------------------------------------
;;; Server state
;;; ---------------------------------------------------------------------------

(defvar *acceptor* nil)
(defvar *port* 57284)

;;; ---------------------------------------------------------------------------
;;; Response helpers
;;; ---------------------------------------------------------------------------

(defun set-json-headers ()
  (setf (hunchentoot:content-type*) "application/json; charset=utf-8")
  (setf (hunchentoot:header-out "Access-Control-Allow-Origin") "*")
  (setf (hunchentoot:header-out "Access-Control-Allow-Methods")
        "GET, POST, PUT, DELETE, OPTIONS")
  (setf (hunchentoot:header-out "Access-Control-Allow-Headers")
        "Content-Type, Authorization")
  (setf (hunchentoot:header-out "Access-Control-Max-Age") "86400"))

(defun json-ok (data)
  (set-json-headers)
  (jonathan:to-json (list :|ok| t :|data| data)))

(defun json-error (message &optional (status 400))
  (set-json-headers)
  (setf (hunchentoot:return-code*) status)
  (jonathan:to-json (list :|ok| :false :|error| message)))

(defun read-json-body ()
  "リクエストボディをJSONとしてパースして返す"
  (handler-case
      (let ((raw (hunchentoot:raw-post-data :force-text t)))
        (if (and raw (> (length raw) 0))
            (jonathan:parse raw)
            nil))
    (error ()
      nil)))

(defmacro with-error-handling (&body body)
  `(handler-case
       (progn ,@body)
     (error (c)
       (json-error (format nil "~A" c) 500))))

;;; ---------------------------------------------------------------------------
;;; Custom acceptor with routing
;;; ---------------------------------------------------------------------------

(defclass booth-acceptor (hunchentoot:acceptor)
  ()
  (:default-initargs
   :access-log-destination nil
   :message-log-destination *error-output*))

(defmethod hunchentoot:acceptor-dispatch-request
    ((acceptor booth-acceptor) request)
  (let ((uri (hunchentoot:request-uri* request))
        (method (hunchentoot:request-method* request)))

    ;; OPTIONS プリフライトに即座に応答
    (when (eq method :options)
      (set-json-headers)
      (return-from hunchentoot:acceptor-dispatch-request "{}"))

    (cond
      ;; GET /api/status
      ((and (eq method :get) (string= uri "/api/status"))
       (handle-status))

      ;; POST /api/cookies
      ((and (eq method :post) (string= uri "/api/cookies"))
       (handle-set-cookies))

      ;; DELETE /api/cookies  (後方互換)
      ((and (eq method :delete) (string= uri "/api/cookies"))
       (handle-clear-cookies))

      ;; POST /api/logout  (推奨)
      ((and (eq method :post) (string= uri "/api/logout"))
       (handle-clear-cookies))

      ;; GET /api/orders
      ((and (eq method :get) (string= uri "/api/orders"))
       (handle-get-orders))

      ;; POST /api/orders  (手動登録)
      ((and (eq method :post) (string= uri "/api/orders"))
       (handle-add-manual-order))

      ;; GET /api/orders/:id/downloads
      ((and (eq method :get)
            (cl-ppcre:scan "^/api/orders/\\d+/downloads$" uri))
       (handle-get-downloads uri))

      ;; DELETE /api/orders/:id
      ((and (eq method :delete)
            (cl-ppcre:scan "^/api/orders/\\d+$" uri))
       (handle-delete-order uri))

      ;; POST /api/sync  (即時同期)
      ((and (eq method :post) (string= uri "/api/sync"))
       (handle-trigger-sync))

      ;; GET /api/sync/status
      ((and (eq method :get) (string= uri "/api/sync/status"))
       (handle-sync-status))

      ;; POST /api/item-info  (商品情報取得)
      ((and (eq method :post) (string= uri "/api/item-info"))
       (handle-item-info))

      ;; 404
      (t
       (set-json-headers)
       (setf (hunchentoot:return-code*) 404)
       (jonathan:to-json (list :|ok| nil :|error| "Not found"))))))

;;; ---------------------------------------------------------------------------
;;; Handlers
;;; ---------------------------------------------------------------------------

(defun handle-status ()
  (with-error-handling
    (set-json-headers)
    (let ((status (cl-booth-library-manager.scheduler:get-status)))
      (jonathan:to-json
       (list :|ok| t
             :|version| "0.2.0"
             :|isLoggedIn| (if (getf status :is-logged-in) t :false)
             :|isSyncing| (if (getf status :is-syncing) t :false)
             :|lastSyncedAt| (getf status :last-synced-at)
             :|nextSyncAt| (getf status :next-sync-at)
             :|secondsUntilNext| (getf status :seconds-until-next))))))

(defun handle-set-cookies ()
  (with-error-handling
    (let ((body (read-json-body)))
      (unless body
        (return-from handle-set-cookies (json-error "Invalid JSON body")))
      (let ((cookies (getf body :|cookies|)))
        (unless cookies
          (return-from handle-set-cookies (json-error "Missing 'cookies' field")))
        ;; cookiesがリストなら再シリアライズ、文字列ならそのまま保存
        (let ((cookies-json (if (stringp cookies)
                                cookies
                                (jonathan:to-json cookies))))
          (cl-booth-library-manager.db:save-cookies cookies-json))
        ;; ログイン直後に同期開始
        (handler-case
            (cl-booth-library-manager.scheduler:trigger-sync)
          (error (c)
            (format *error-output* "[api] trigger-sync failed: ~A~%" c)))
        (json-ok (list :|message| "Cookies saved, sync started"))))))

(defun handle-clear-cookies ()
  (with-error-handling
    (cl-booth-library-manager.db:clear-cookies)
    (json-ok (list :|message| "Logged out"))))

(defun handle-get-orders ()
  (with-error-handling
    (let ((orders (cl-booth-library-manager.db:get-all-orders)))
      (json-ok
       (mapcar (lambda (o)
                 (list :|id|           (getf o :id)
                       :|boothOrderId| (or (getf o :booth-order-id) "")
                       :|itemId|       (or (getf o :item-id) "")
                       :|itemName|     (or (getf o :item-name) "")
                       :|shopName|     (or (getf o :shop-name) "")
                       :|itemUrl|      (or (getf o :item-url) "")
                       :|thumbnailUrl| (or (getf o :thumbnail-url) "")
                       :|price|        (or (getf o :price) 0)
                       :|currency|     (or (getf o :currency) "JPY")
                       :|purchasedAt|  (or (getf o :purchased-at) "")
                       :|isManual|      (if (getf o :is-manual) t :false)
                       :|downloadCount| (or (getf o :download-count) 0)
                       :|downloadLabels| (or (getf o :download-labels) "")))
               orders)))))

(defun handle-add-manual-order ()
  (with-error-handling
    (let* ((body (read-json-body))
           (item-url     (getf body :|itemUrl|))
           (item-name    (getf body :|itemName|))
           (shop-name    (or (getf body :|shopName|) ""))
           (thumb-url    (or (getf body :|thumbnailUrl|) ""))
           (price        (or (getf body :|price|) 0))
           (currency     (or (getf body :|currency|) "JPY"))
           (dl-links     (getf body :|downloadLinks|)))

      ;; URLが指定されていてitem-nameが未指定の場合は商品ページから取得
      (when (and item-url (or (null item-name) (= 0 (length (or item-name "")))))
        (handler-case
            (let ((info (cl-booth-library-manager.scraper:fetch-item-info item-url)))
              (setf item-name  (or (getf info :item-name) ""))
              (setf shop-name  (or shop-name (getf info :shop-name) ""))
              (setf thumb-url  (or thumb-url (getf info :thumbnail-url) "")))
          (error (c)
            (format *error-output* "[api] fetch-item-info failed: ~A~%" c))))

      (unless (and item-name (> (length item-name) 0))
        (return-from handle-add-manual-order
          (json-error "itemName is required")))

      (let* ((links (mapcar (lambda (dl)
                              (list :label (or (getf dl :|label|) "download")
                                    :url   (getf dl :|url|)))
                            (or dl-links '())))
             (order-id (cl-booth-library-manager.db:add-manual-order
                        item-name shop-name item-url thumb-url
                        price currency links)))
        (json-ok (list :|orderId| order-id))))))

(defun handle-get-downloads (uri)
  (with-error-handling
    (cl-ppcre:register-groups-bind (id-str)
        ("^/api/orders/(\\d+)/downloads$" uri)
      (let* ((order-id (parse-integer id-str))
             (links (cl-booth-library-manager.db:get-order-downloads order-id)))
        (json-ok
         (mapcar (lambda (l)
                   (list :|id|    (getf l :id)
                         :|label| (getf l :label)
                         :|url|   (getf l :url)))
                 links))))))

(defun handle-delete-order (uri)
  (with-error-handling
    (cl-ppcre:register-groups-bind (id-str)
        ("^/api/orders/(\\d+)$" uri)
      (cl-booth-library-manager.db:delete-order (parse-integer id-str))
      (json-ok (list :|message| "Deleted")))))

(defun handle-trigger-sync ()
  (with-error-handling
    (handler-case
        (progn
          (cl-booth-library-manager.scheduler:trigger-sync)
          (json-ok (list :|message| "Sync started")))
      (error (c)
        (json-error (format nil "~A" c))))))

(defun handle-sync-status ()
  (with-error-handling
    (let ((status (cl-booth-library-manager.scheduler:get-status)))
      (set-json-headers)
      (jonathan:to-json
       (list :|isSyncing| (if (getf status :is-syncing) t :false)
             :|lastSyncedAt| (getf status :last-synced-at)
             :|nextSyncAt| (getf status :next-sync-at)
             :|secondsUntilNext| (getf status :seconds-until-next)
             :|isLoggedIn| (if (getf status :is-logged-in) t :false))))))

(defun handle-item-info ()
  (with-error-handling
    (let* ((body (read-json-body))
           (url  (getf body :|url|)))
      (unless url
        (return-from handle-item-info (json-error "Missing 'url' field")))
      (let ((info (cl-booth-library-manager.scraper:fetch-item-info url)))
        (json-ok
         (list :|itemName|     (getf info :item-name)
               :|shopName|     (getf info :shop-name)
               :|thumbnailUrl| (getf info :thumbnail-url)
               :|price|        (getf info :price)
               :|description|  (getf info :description)))))))

;;; ---------------------------------------------------------------------------
;;; Server lifecycle
;;; ---------------------------------------------------------------------------

(defun start-server (&optional (port *port*))
  (setf *acceptor*
        (make-instance 'booth-acceptor :port port))
  (hunchentoot:start *acceptor*)
  (format t "[api] Server started on port ~A~%" port)
  port)

(defun stop-server ()
  (when *acceptor*
    (hunchentoot:stop *acceptor*)
    (setf *acceptor* nil)
    (format t "[api] Server stopped~%")))
