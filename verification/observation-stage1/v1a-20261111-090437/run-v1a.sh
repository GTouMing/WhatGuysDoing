set -euo pipefail
RUN='E:/Projects/WhatGuysDoing/verification/observation-stage1/v1a-20261111-090437'
JDK='/e/Java/21/bin'
case "${1:-toolchain}" in
  toolchain)
    "$JDK/java.exe" -Xms16m -Xmx128m -XX:-UsePerfData "-Djava.io.tmpdir=$RUN/tmp" "-Duser.home=$RUN/tmp" "-XX:ErrorFile=$RUN/logs/hs_err_pid%p.log" -version > "$RUN/logs/java-version.txt" 2>&1
    "$JDK/javac.exe" -J-Xmx128m -J-XX:-UsePerfData "-J-Djava.io.tmpdir=$RUN/tmp" "-J-Duser.home=$RUN/tmp" -version > "$RUN/logs/javac-version.txt" 2>&1
    cat "$RUN/logs/java-version.txt" "$RUN/logs/javac-version.txt"
    ;;
  compile)
    "$JDK/javac.exe" -J-Xmx256m -J-XX:-UsePerfData "-J-Djava.io.tmpdir=$RUN/tmp" "-J-Duser.home=$RUN/tmp" -proc:none --release 21 -encoding UTF-8 -Xlint:all -classpath "$RUN/classes" -sourcepath "$RUN/src" -d "$RUN/classes" "$RUN/src/V1aStorageProbe.java" > "$RUN/logs/compile.txt" 2>&1
    cat "$RUN/logs/compile.txt"
    printf '%s\n' 'ISOLATED_COMPILATION_OK'
    ;;
  replacement-red|replacement-green|read-boundaries|write-boundaries|interrupt-partial)
    mode=$1
    set +e
    "$JDK/java.exe" -Xms16m -Xmx256m -XX:-UsePerfData "-Djava.io.tmpdir=$RUN/tmp" "-Duser.home=$RUN/tmp" "-XX:ErrorFile=$RUN/logs/hs_err_pid%p.log" -cp "$RUN/classes" V1aStorageProbe "$mode" > "$RUN/logs/$mode.txt" 2>&1
    result=$?
    cat "$RUN/logs/$mode.txt"
    printf 'RAW_TEST_EXIT=%s\n' "$result"
    exit "$result"
    ;;
  *) printf '%s\n' 'Unsupported isolated runner mode' >&2; exit 2 ;;
esac
