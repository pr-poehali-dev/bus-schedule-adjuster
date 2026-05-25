import { useState, useEffect, useRef, useCallback } from "react";
import Icon from "@/components/ui/icon";

interface Stop {
  id: number;
  name: string;
  scheduledTime: string;
  actualTime: string | null;
  status: "pending" | "current" | "done" | "delayed";
  minutesFromStart: number;
}

const ROUTE_STOPS: Omit<Stop, "actualTime" | "status">[] = [
  { id: 1, name: "Депо — Начальная", scheduledTime: "05:22", minutesFromStart: 0 },
  { id: 2, name: "ул. Гагарина", scheduledTime: "05:30", minutesFromStart: 8 },
  { id: 3, name: "Рынок Центральный", scheduledTime: "05:38", minutesFromStart: 16 },
  { id: 4, name: "Площадь Победы", scheduledTime: "05:45", minutesFromStart: 23 },
  { id: 5, name: "Больница №1", scheduledTime: "05:52", minutesFromStart: 30 },
  { id: 6, name: "ТЦ Орбита", scheduledTime: "05:59", minutesFromStart: 37 },
  { id: 7, name: "Школа №12", scheduledTime: "06:07", minutesFromStart: 45 },
  { id: 8, name: "Автовокзал — Конечная", scheduledTime: "06:15", minutesFromStart: 53 },
];

function timeToMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

function minutesToTime(mins: number): string {
  const h = Math.floor(mins / 60) % 24;
  const m = mins % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function getDeltaLabel(delta: number): string {
  if (Math.abs(delta) <= 1) return "По графику";
  if (delta > 1) return `+${delta} мин — опережение`;
  return `${delta} мин — отставание`;
}

export default function Index() {
  const [currentTime, setCurrentTime] = useState(new Date());
  const [isRunning, setIsRunning] = useState(false);
  const [actualDepartureMinutes, setActualDepartureMinutes] = useState<number | null>(null);
  const [stops, setStops] = useState<Stop[]>(
    ROUTE_STOPS.map((s) => ({ ...s, actualTime: null, status: "pending" as const }))
  );
  const [currentStopIndex, setCurrentStopIndex] = useState(0);
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const [lastAnnouncedStop, setLastAnnouncedStop] = useState(-1);
  const synthRef = useRef<SpeechSynthesis | null>(null);

  useEffect(() => {
    synthRef.current = window.speechSynthesis;
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const speak = useCallback((text: string) => {
    if (!voiceEnabled || !synthRef.current) return;
    synthRef.current.cancel();
    const utt = new SpeechSynthesisUtterance(text);
    utt.lang = "ru-RU";
    utt.rate = 0.95;
    utt.pitch = 1.0;
    utt.volume = 1.0;
    synthRef.current.speak(utt);
  }, [voiceEnabled]);

  const getCurrentMinutes = useCallback(() => {
    return currentTime.getHours() * 60 + currentTime.getMinutes();
  }, [currentTime]);

  useEffect(() => {
    if (!isRunning || actualDepartureMinutes === null) return;
    const nowMin = getCurrentMinutes();
    const elapsedFromDeparture = nowMin - actualDepartureMinutes;
    const scheduledDepartureMin = timeToMinutes(ROUTE_STOPS[0].scheduledTime);
    const delta = actualDepartureMinutes - scheduledDepartureMin;

    const newStops: Stop[] = ROUTE_STOPS.map((s, i) => {
      const scheduledMin = timeToMinutes(s.scheduledTime);
      const adjustedMin = scheduledMin + delta;
      const adjustedTime = minutesToTime(adjustedMin);

      if (i === 0) {
        return { ...s, actualTime: minutesToTime(actualDepartureMinutes), status: "done" as const };
      }
      if (elapsedFromDeparture >= s.minutesFromStart) {
        return { ...s, actualTime: adjustedTime, status: "done" as const };
      } else if (elapsedFromDeparture >= s.minutesFromStart - 2) {
        return { ...s, actualTime: adjustedTime, status: "current" as const };
      } else {
        const late = delta < -2;
        return { ...s, actualTime: adjustedTime, status: late ? "delayed" as const : "pending" as const };
      }
    });

    setStops(newStops);

    const currentIdx = newStops.findIndex((s) => s.status === "current");
    const doneCount = newStops.filter((s) => s.status === "done").length;
    const activeIdx = currentIdx >= 0 ? currentIdx : doneCount;
    setCurrentStopIndex(Math.min(activeIdx, ROUTE_STOPS.length - 1));

    if (currentIdx >= 0 && currentIdx !== lastAnnouncedStop) {
      const stop = newStops[currentIdx];
      const announceText =
        currentIdx === ROUTE_STOPS.length - 1
          ? `Конечная остановка. ${stop.name}. Просьба освободить салон.`
          : `Следующая остановка — ${stop.name}.`;
      speak(announceText);
      setLastAnnouncedStop(currentIdx);
    }
  }, [currentTime, isRunning, actualDepartureMinutes, speak, lastAnnouncedStop, getCurrentMinutes]);

  const handleStart = () => {
    const nowMin = getCurrentMinutes();
    setActualDepartureMinutes(nowMin);
    setIsRunning(true);
    setLastAnnouncedStop(-1);
    const scheduledMin = timeToMinutes(ROUTE_STOPS[0].scheduledTime);
    const delta = nowMin - scheduledMin;
    const deltaLabel = getDeltaLabel(delta);
    speak(`Маршрут начат. ${deltaLabel}. Конечная остановка — ${ROUTE_STOPS[ROUTE_STOPS.length - 1].name}.`);
  };

  const handleStop = () => {
    setIsRunning(false);
    setActualDepartureMinutes(null);
    setStops(ROUTE_STOPS.map((s) => ({ ...s, actualTime: null, status: "pending" })));
    setCurrentStopIndex(0);
    speak("Маршрут завершён.");
  };

  const scheduledDeptMin = timeToMinutes(ROUTE_STOPS[0].scheduledTime);
  const nowMin = getCurrentMinutes();
  const delta = actualDepartureMinutes !== null
    ? actualDepartureMinutes - scheduledDeptMin
    : nowMin - scheduledDeptMin;
  const isOnTime = Math.abs(delta) <= 1;
  const isAhead = delta > 1;

  const doneStops = stops.filter((s) => s.status === "done").length;
  const totalStops = stops.length;
  const progressPct = isRunning ? Math.round((doneStops / (totalStops - 1)) * 100) : 0;

  const estimatedArrival = actualDepartureMinutes !== null
    ? minutesToTime(actualDepartureMinutes + ROUTE_STOPS[ROUTE_STOPS.length - 1].minutesFromStart)
    : ROUTE_STOPS[ROUTE_STOPS.length - 1].scheduledTime;

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col" style={{ fontFamily: "'Roboto', sans-serif" }}>

      {/* Header */}
      <header className="sticky top-0 z-20 bg-card border-b border-border px-4 py-3 flex items-center justify-between shadow-xl">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-full bg-primary flex items-center justify-center shadow-lg">
            <Icon name="Bus" size={17} className="text-primary-foreground" />
          </div>
          <div>
            <div className="text-xs text-muted-foreground uppercase tracking-widest leading-none" style={{ fontFamily: "'Oswald', sans-serif" }}>
              Маршрут №15
            </div>
            <div className="text-sm font-medium text-foreground leading-tight mt-0.5">
              Депо → Автовокзал
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => setVoiceEnabled(!voiceEnabled)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${
              voiceEnabled
                ? "bg-accent/15 text-accent border-accent/40"
                : "bg-muted text-muted-foreground border-border"
            }`}
          >
            <Icon name={voiceEnabled ? "Volume2" : "VolumeX"} size={13} />
            {voiceEnabled ? "Голос" : "Тихо"}
          </button>

          <div className="text-2xl font-bold text-primary tabular-nums" style={{ fontFamily: "'Oswald', sans-serif" }}>
            {currentTime.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
          </div>
        </div>
      </header>

      {/* Running status bar */}
      {isRunning && (
        <div className={`px-4 py-2 flex items-center justify-between text-sm font-medium border-b border-border ${
          isOnTime
            ? "bg-accent/10 text-accent"
            : isAhead
            ? "bg-blue-500/10 text-blue-400"
            : "bg-destructive/10 text-destructive"
        }`}>
          <div className="flex items-center gap-2">
            <Icon
              name={isOnTime ? "CheckCircle" : isAhead ? "TrendingUp" : "AlertTriangle"}
              size={15}
            />
            <span>{getDeltaLabel(delta)}</span>
          </div>
          <span className="text-xs text-muted-foreground">
            Прибытие: <strong className="text-foreground">{estimatedArrival}</strong>
          </span>
        </div>
      )}

      {/* Progress bar */}
      {isRunning && (
        <div className="h-1.5 bg-muted">
          <div
            className="h-full bg-primary transition-all duration-1000"
            style={{ width: `${progressPct}%` }}
          />
        </div>
      )}

      {/* Control panel */}
      <div className="p-4 bg-card/50 border-b border-border">
        {!isRunning ? (
          <div className="flex items-end gap-3">
            <div className="flex-1">
              <div className="text-xs text-muted-foreground uppercase tracking-widest mb-1" style={{ fontFamily: "'Oswald', sans-serif" }}>
                Плановое время выезда
              </div>
              <div className="text-4xl font-bold text-primary tabular-nums" style={{ fontFamily: "'Oswald', sans-serif" }}>
                {ROUTE_STOPS[0].scheduledTime}
              </div>
              <div className="text-xs text-muted-foreground mt-1">
                Сейчас {currentTime.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}
                {"  "}
                {nowMin > scheduledDeptMin ? (
                  <span className="text-destructive font-medium">задержка {nowMin - scheduledDeptMin} мин</span>
                ) : nowMin < scheduledDeptMin ? (
                  <span className="text-blue-400">до выезда {scheduledDeptMin - nowMin} мин</span>
                ) : (
                  <span className="text-accent">по графику</span>
                )}
              </div>
            </div>
            <button
              onClick={handleStart}
              className="flex items-center gap-2 bg-primary text-primary-foreground px-6 py-3.5 rounded-xl font-semibold text-base active:scale-95 transition-transform shadow-lg shadow-primary/20"
              style={{ fontFamily: "'Oswald', sans-serif", letterSpacing: "0.06em" }}
            >
              <Icon name="Play" size={18} />
              ВЫЕХАТЬ
            </button>
          </div>
        ) : (
          <div className="flex items-center justify-between">
            <div>
              <div className="text-xs text-muted-foreground uppercase tracking-widest" style={{ fontFamily: "'Oswald', sans-serif" }}>
                Маршрут активен
              </div>
              <div className="text-sm text-foreground mt-0.5">
                Выехал в{" "}
                <strong className="text-primary">{minutesToTime(actualDepartureMinutes!)}</strong>
                {"  ·  "}
                <strong>{doneStops}</strong> из <strong>{totalStops}</strong> остановок
              </div>
            </div>
            <button
              onClick={handleStop}
              className="flex items-center gap-2 bg-destructive/15 text-destructive border border-destructive/30 px-4 py-2.5 rounded-xl font-semibold text-sm active:scale-95 transition-transform"
              style={{ fontFamily: "'Oswald', sans-serif" }}
            >
              <Icon name="Square" size={14} />
              ЗАВЕРШИТЬ
            </button>
          </div>
        )}
      </div>

      {/* Stops list */}
      <div className="flex-1 overflow-y-auto p-4 space-y-2 pb-6">
        <div
          className="text-xs text-muted-foreground uppercase tracking-widest mb-3 flex items-center gap-1.5"
          style={{ fontFamily: "'Oswald', sans-serif" }}
        >
          <Icon name="MapPin" size={12} />
          Остановки маршрута
        </div>

        {stops.map((stop, i) => {
          const isFirst = i === 0;
          const isLast = i === stops.length - 1;
          const isCurrent = stop.status === "current";
          const isDone = stop.status === "done";
          const isDelayed = stop.status === "delayed";

          return (
            <div
              key={stop.id}
              className={`relative flex items-stretch rounded-xl overflow-hidden border transition-all ${
                isCurrent
                  ? "border-primary bg-primary/10 shadow-lg shadow-primary/10"
                  : isDone
                  ? "border-border/40 bg-card/30 opacity-60"
                  : isDelayed
                  ? "border-destructive/30 bg-destructive/5"
                  : "border-border bg-card/60"
              }`}
            >
              {/* Left accent stripe */}
              <div
                className={`w-1 flex-shrink-0 ${
                  isCurrent
                    ? "bg-primary"
                    : isDone
                    ? "bg-accent/40"
                    : isDelayed
                    ? "bg-destructive/60"
                    : isFirst
                    ? "bg-blue-500/60"
                    : isLast
                    ? "bg-red-500/60"
                    : "bg-border"
                }`}
              />

              <div className="flex-1 flex items-center gap-3 px-3 py-3 pr-10">
                {/* Badge */}
                <div
                  className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0 ${
                    isCurrent
                      ? "bg-primary text-primary-foreground"
                      : isDone
                      ? "bg-accent/20 text-accent"
                      : isFirst
                      ? "bg-blue-500/20 text-blue-400"
                      : isLast
                      ? "bg-red-500/20 text-red-400"
                      : "bg-muted text-muted-foreground"
                  }`}
                  style={{ fontFamily: "'Oswald', sans-serif" }}
                >
                  {isDone ? <Icon name="Check" size={14} /> : stop.id}
                </div>

                {/* Name */}
                <div className="flex-1 min-w-0">
                  <div
                    className={`font-medium text-sm leading-tight ${
                      isCurrent
                        ? "text-primary"
                        : isDone
                        ? "text-muted-foreground"
                        : "text-foreground"
                    }`}
                  >
                    {stop.name}
                  </div>
                  {(isFirst || isLast) && (
                    <div className={`text-xs mt-0.5 ${isFirst ? "text-blue-400" : "text-red-400"}`}>
                      {isFirst ? "Начальная" : "Конечная"}
                    </div>
                  )}
                </div>

                {/* Time */}
                <div className="text-right flex-shrink-0">
                  <div
                    className={`text-xl font-bold tabular-nums ${
                      isCurrent
                        ? "text-primary"
                        : isDone
                        ? "text-muted-foreground"
                        : isDelayed
                        ? "text-destructive"
                        : "text-foreground"
                    }`}
                    style={{ fontFamily: "'Oswald', sans-serif" }}
                  >
                    {isRunning && stop.actualTime ? stop.actualTime : stop.scheduledTime}
                  </div>
                  {isRunning &&
                    stop.actualTime &&
                    stop.actualTime !== stop.scheduledTime &&
                    !isDone && (
                      <div
                        className={`text-xs ${
                          timeToMinutes(stop.actualTime) > timeToMinutes(stop.scheduledTime)
                            ? "text-destructive"
                            : "text-blue-400"
                        }`}
                      >
                        план: {stop.scheduledTime}
                      </div>
                    )}
                </div>
              </div>

              {/* Pulse dot for current */}
              {isCurrent && (
                <div className="absolute right-3 top-1/2 -translate-y-1/2">
                  <div className="w-2.5 h-2.5 rounded-full bg-primary animate-pulse" />
                </div>
              )}
            </div>
          );
        })}

        {/* Summary */}
        <div className="grid grid-cols-3 gap-2.5 pt-3 border-t border-border mt-4">
          {[
            { label: "Отправление", value: ROUTE_STOPS[0].scheduledTime, icon: "PlayCircle", color: "text-blue-400" },
            { label: "В пути", value: "53 мин", icon: "Clock", color: "text-primary" },
            { label: "Прибытие", value: ROUTE_STOPS[ROUTE_STOPS.length - 1].scheduledTime, icon: "StopCircle", color: "text-red-400" },
          ].map(({ label, value, icon, color }) => (
            <div key={label} className="bg-card border border-border rounded-xl p-3 text-center">
              <Icon name={icon} fallback="Clock" size={15} className={`${color} mx-auto mb-1`} />
              <div
                className={`text-lg font-bold tabular-nums ${color}`}
                style={{ fontFamily: "'Oswald', sans-serif" }}
              >
                {value}
              </div>
              <div className="text-xs text-muted-foreground mt-0.5">{label}</div>
            </div>
          ))}
        </div>

        {/* Hint */}
        <div className="flex items-start gap-2 bg-muted/20 border border-border rounded-xl p-3 text-xs text-muted-foreground">
          <Icon name="Info" size={13} className="flex-shrink-0 mt-0.5" />
          <span>
            Голосовые оповещения объявляют каждую остановку при приближении. Нажмите{" "}
            <strong className="text-foreground">ВЫЕХАТЬ</strong> в момент отправления — график скорректируется автоматически.
          </span>
        </div>
      </div>
    </div>
  );
}