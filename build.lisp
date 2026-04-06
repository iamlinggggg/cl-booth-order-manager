(load (merge-pathnames "quicklisp/setup.lisp" (user-homedir-pathname)))

(asdf:load-asd (merge-pathnames "cl-booth-order-manager.asd" (truename ".")))

(ql:quickload :cl-booth-library-manager :silent t)

(let ((out-dir (merge-pathnames "dist-cl/" *default-pathname-defaults*)))
  (ensure-directories-exist out-dir)
  (sb-ext:save-lisp-and-die
 (merge-pathnames "booth-backend.exe" out-dir)
 :toplevel #'cl-booth-library-manager:main
 :executable t
 :compression nil))
