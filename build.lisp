(load (merge-pathnames "quicklisp/setup.lisp" (user-homedir-pathname)))

(asdf:load-asd (merge-pathnames "cl-booth-library-manager.asd" (truename ".")))

(ql:quickload :cl-booth-library-manager :silent t)

;; ---------------------------------------------------------------------------
;; CFFI DLL 検索パス設定 (重要)
;;
;; CFFI は sb-ext:*init-hooks* に reopen-foreign-libraries を登録している。
;; このフックより先に push することで、イメージ復元時に exe と同じディレクトリを
;; 検索パスに追加してから DLL を再ロードさせる。
;; (push は先頭追加のため、後から push したものが先に実行される)
;; ---------------------------------------------------------------------------
(push (lambda ()
        (let ((exe-dir (directory-namestring
                        (truename sb-ext:*runtime-pathname*))))
          (pushnew exe-dir cffi:*foreign-library-directories* :test #'equal)
          (format t "[startup] CFFI search path: ~A~%" exe-dir)))
      sb-ext:*init-hooks*)

;; ビルド時にロードされている外部ライブラリ一覧を表示 (バンドル対象DLL確認用)
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
