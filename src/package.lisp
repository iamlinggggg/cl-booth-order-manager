(defpackage :cl-booth-library-manager.db
  (:use :cl)
  (:export #:init-db
           #:close-db
           #:is-logged-in
           #:save-cookies
           #:get-cookies
           #:clear-cookies
           #:get-last-synced-at
           #:set-last-synced-at
           #:get-order-id-by-booth-id
           #:get-download-urls
           #:replace-download-links
           #:upsert-order
           #:insert-download-links
           #:thumbnail-cache-path
           #:thumbnail-cached-p
           #:save-thumbnail
           #:detect-image-content-type
           #:get-thumbnail-url
           #:get-orders-needing-thumbnail
           #:update-thumbnail-url
           #:delete-thumbnail-cache
           #:get-all-orders
           #:get-order-downloads
           #:add-manual-order
           #:update-manual-order
           #:delete-order
           #:save-setting
           #:get-setting))

(defpackage :cl-booth-library-manager.scraper
  (:use :cl)
  (:export #:fetch-orders
           #:fetch-item-info
           #:download-image
           #:cookie-expired-error
           #:app-version))

(defpackage :cl-booth-library-manager.scheduler
  (:use :cl)
  (:export #:start
           #:stop
           #:trigger-sync
           #:get-status
           #:get-settings
           #:set-auto-sync
           #:set-sync-interval
           #:set-full-sync-interval
           #:load-settings))

(defpackage :cl-booth-library-manager.api
  (:use :cl)
  (:export #:start-server
           #:stop-server
           #:*port*))

(defpackage :cl-booth-library-manager
  (:use :cl)
  (:export #:main))
