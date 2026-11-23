set -euo pipefail
set -o noclobber
RUN='E:/Projects/WhatGuysDoing/verification/observation-stage1/v1b-20261111-095001'
JDK='/e/Java/21/bin'
case "${1:-}" in
  compile-startup)
    "$JDK/javac.exe" -J-Xmx256m -J-XX:-UsePerfData "-J-Djava.io.tmpdir=$RUN/tmp" "-J-Duser.home=$RUN/tmp" "-J-XX:ErrorFile=$RUN/logs/javac_hs_err_pid%p.log" -proc:none --release 21 -encoding UTF-8 -Xlint:all -classpath "$RUN/classes" -sourcepath "$RUN/src" -d "$RUN/classes" "$RUN/src/V1bStartupProbe.java" > "$RUN/logs/compile-startup.txt" 2>&1
    cat "$RUN/logs/compile-startup.txt"
    printf '%s\n' 'ISOLATED_STARTUP_COMPILATION_OK'
    ;;
  startup-gate)
    set +e
    "$JDK/java.exe" -Xms16m -Xmx256m -XX:-UsePerfData "-Djava.io.tmpdir=$RUN/tmp" "-Duser.home=$RUN/tmp" "-XX:ErrorFile=$RUN/logs/parent_hs_err_pid%p.log" -cp "$RUN/classes" V1bStartupProbe startup-gate > "$RUN/logs/startup-gate.txt" 2>&1
    result=$?
    cat "$RUN/logs/startup-gate.txt"
    printf 'RAW_STARTUP_GATE_EXIT=%s\n' "$result"
    exit "$result"
    ;;
  *) printf '%s\n' 'Unsupported approved startup runner mode' >&2; exit 2 ;;
esac
