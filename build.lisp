(load (merge-pathnames "quicklisp/setup.lisp" (user-homedir-pathname)))

(asdf:load-asd (merge-pathnames "cl-booth-library-manager.asd" (truename ".")))

(ql:quickload :cl-booth-library-manager :silent t)

(push (lambda ()
        (handler-case
            (let ((exe-dir (directory-namestring
                            (truename sb-ext:*runtime-pathname*))))
              (pushnew exe-dir cffi:*foreign-library-directories* :test #'equal)
              (format *error-output* "[cffi-init] DLL search path: ~A~%" exe-dir)
              (force-output *error-output*))
          (error (c)
            (format *error-output* "[cffi-init] WARNING: path setup failed: ~A~%" c)
            (force-output *error-output*))))
      sb-ext:*init-hooks*)

;; ビルド時にロードされている外部ライブラリ一覧を表示
(format t "~%=== Loaded foreign libraries ===~%")
(dolist (lib (cffi:list-foreign-libraries :loaded-only t))
  (let ((path (cffi:foreign-library-pathname lib)))
    (format t "  ~A~%" path)))
(format t "================================~%~%")

(let ((out-dir (merge-pathnames "dist-cl/" *default-pathname-defaults*)))
  (ensure-directories-exist out-dir)
  (sb-ext:save-lisp-and-die
   (merge-pathnames "booth-backend.exe" out-dir)
   :toplevel #'cl-booth-library-manager:main
   :executable t
   :compression nil))
