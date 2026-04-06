(defsystem "cl-booth-library-manager"
  :version "0.2.0"
  :author "iamlinggggg"
  :license "MIT"
  :depends-on ("dexador"          ; HTTP client
               "plump"            ; HTML parser
               "lquery"           ; CSS selector engine
               "cl-ppcre"         ; Regular expressions
               "sqlite"           ; SQLite
               "hunchentoot"      ; HTTP server
               "jonathan"         ; JSON encode/decode
               "bordeaux-threads" ; Threading
               "uiop")            ; Cross-platform utilities
  :components ((:module "src"
                :components
                ((:file "package")
                 (:file "db"        :depends-on ("package"))
                 (:file "scraper"   :depends-on ("package" "db"))
                 (:file "scheduler" :depends-on ("package" "db" "scraper"))
                 (:file "api"       :depends-on ("package" "db" "scraper" "scheduler"))
                 (:file "main"      :depends-on ("package" "db" "api" "scheduler")))))
  :description "BOOTHのライブラリを管理するデスクトップアプリのバックエンド"
  :build-operation "program-op"
  :build-pathname "booth-backend"
  :entry-point "cl-booth-library-manager:main")
