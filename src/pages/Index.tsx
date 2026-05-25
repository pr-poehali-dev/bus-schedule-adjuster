import { useState, useEffect, useRef, useCallback } from "react";
import Icon from "@/components/ui/icon";

// ─── Остановки маршрута №18 Астрахань ────────────────────────────────────────
// Прямой: ТЦ Добрострой → ул. Садовских
// Обратный: ул. Садовских → ТЦ Добрострой

const STOPS_FORWARD = [
  "ТЦ Добрострой",
  "АТРЗ",
  "ТЦ Метро",
  "Школа №37",
  "Автогородок",
  "Хлебозавод №5",
  "Жилгородок",
  "ул. Трофимова",
  "Татар-Базар",
  "Площадь Ленина",
  "Сквер Ульяновых",
  "ЦУМ",
  "Коммунистическая",
  "Картинная галерея",
  "Рынок Большие Исады",
  "Грузинская",
  "ТЦ Александрия",
  "Технический колледж",
  "Старое кладбище",
  "Больничный комплекс",
  "Набережная Казачьего ерика",
  "Кардиоцентр",
  "Областная детская больница",
  "Техучилище №6",
  "Судоверфь Кирова",
  "Горбольница №4",
  "ул. Садовских",
];

const STOPS_BACKWARD = [...STOPS_FORWARD].reverse();

interface Trip {
  id: number;
  departureTime: string;
  arrivalTime: string;
  direction: "forward" | "backward";
}

interface Stop {
  id: number;
  name: string;
  scheduledTime: string;
  status: "pending" | "current" | "done" | "delayed";
  minutesFromStart: number;
}

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

function buildStops(departureTime: string, arrivalTime: string, direction: "forward" | "backward"): Stop[] {
  const names = direction === "forward" ? STOPS_FORWARD : STOPS_BACKWARD;
  const depMin = timeToMinutes(departureTime);
  const arrMin = timeToMinutes(arrivalTime);
  const totalMin = arrMin - depMin;
  const count = names.length;

  return names.map((name, i) => {
    const minutesFromStart = Math.round((totalMin / (count - 1)) * i);
    const scheduledMin = depMin + minutesFromStart;
    return {
      id: i + 1,
      name,
      scheduledTime: minutesToTime(scheduledMin),
      status: "pending" as const,
      minutesFromStart,
    };
  });
}

const STORAGE_KEY = "route18_trips";

function loadTrips(): Trip[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) { void e; }
  return [];
}

function saveTrips(trips: Trip[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(trips));
}

type Screen = "waybill" | "tripList" | "running";

export default function Index() {
  const [screen, setScreen] = useState<Screen>("waybill");
  const [trips, setTrips] = useState<Trip[]>(loadTrips);
  const [currentTripIdx, setCurrentTripIdx] = useState(0);
  const [currentTime, setCurrentTime] = useState(new Date());
  const [isRunning, setIsRunning] = useState(false);
  const [actualDepartureMinutes, setActualDepartureMinutes] = useState<number | null>(null);
  const [stops, setStops] = useState<Stop[]>([]);
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const [lastAnnouncedStop, setLastAnnouncedStop] = useState(-1);
  const synthRef = useRef<SpeechSynthesis | null>(null);

  // Форма путевого листа
  const emptyTrip = (): Omit<Trip, "id"> => ({ departureTime: "", arrivalTime: "", direction: "forward" });
  const [formTrips, setFormTrips] = useState<Omit<Trip, "id">[]>(
    Array.from({ length: 10 }, emptyTrip)
  );

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
    synthRef.current.speak(utt);
  }, [voiceEnabled]);

  const getCurrentMinutes = useCallback(() => {
    return currentTime.getHours() * 60 + currentTime.getMinutes();
  }, [currentTime]);

  // Логика обновления остановок
  useEffect(() => {
    if (!isRunning || actualDepartureMinutes === null || stops.length === 0) return;
    const nowMin = getCurrentMinutes();
    const elapsedFromDeparture = nowMin - actualDepartureMinutes;
    const scheduledDeptMin = timeToMinutes(stops[0].scheduledTime);
    const delta = actualDepartureMinutes - scheduledDeptMin;

    const newStops: Stop[] = stops.map((s, i) => {
      const adjustedMin = timeToMinutes(s.scheduledTime) + delta;
      if (i === 0) return { ...s, status: "done" as const };
      if (elapsedFromDeparture >= s.minutesFromStart) return { ...s, status: "done" as const };
      if (elapsedFromDeparture >= s.minutesFromStart - 2) return { ...s, status: "current" as const };
      return { ...s, status: delta < -2 ? "delayed" as const : "pending" as const };
    });

    setStops(newStops);

    const currentIdx = newStops.findIndex((s) => s.status === "current");
    if (currentIdx >= 0 && currentIdx !== lastAnnouncedStop) {
      const name = newStops[currentIdx].name;
      const isLast = currentIdx === newStops.length - 1;
      speak(isLast ? `Конечная остановка. ${name}. Просьба освободить салон.` : `Следующая остановка — ${name}.`);
      setLastAnnouncedStop(currentIdx);
    }
  }, [currentTime, isRunning, actualDepartureMinutes, stops.length, speak, lastAnnouncedStop, getCurrentMinutes]);

  // ─── Путевой лист ─────────────────────────────────────────────────────────

  const handleSaveWaybill = () => {
    const filled = formTrips.filter((t) => t.departureTime && t.arrivalTime);
    if (filled.length === 0) return;
    const built: Trip[] = filled.map((t, i) => ({ ...t, id: i + 1 }));
    setTrips(built);
    saveTrips(built);
    setScreen("tripList");
  };

  const updateFormTrip = (idx: number, field: keyof Omit<Trip, "id">, value: string) => {
    setFormTrips((prev) => prev.map((t, i) => i === idx ? { ...t, [field]: value } : t));
  };

  // ─── Запуск рейса ──────────────────────────────────────────────────────────

  const startTrip = (idx: number) => {
    const trip = trips[idx];
    setCurrentTripIdx(idx);
    const builtStops = buildStops(trip.departureTime, trip.arrivalTime, trip.direction);
    setStops(builtStops);
    const nowMin = getCurrentMinutes();
    setActualDepartureMinutes(nowMin);
    setIsRunning(true);
    setLastAnnouncedStop(-1);
    const scheduledMin = timeToMinutes(trip.departureTime);
    const delta = nowMin - scheduledMin;
    const dir = trip.direction === "forward" ? "ТЦ Добрострой — ул. Садовских" : "ул. Садовских — ТЦ Добрострой";
    speak(`Рейс ${idx + 1}. ${dir}. ${getDeltaLabel(delta)}.`);
    setScreen("running");
  };

  const handleStop = () => {
    setIsRunning(false);
    setActualDepartureMinutes(null);
    setLastAnnouncedStop(-1);
    speak("Рейс завершён.");
    setScreen("tripList");
  };

  const currentTrip = trips[currentTripIdx];
  const nowMin = getCurrentMinutes();

  // Расчёт отставания/опережения для текущего рейса
  const scheduledDeptMin = isRunning && currentTrip ? timeToMinutes(currentTrip.departureTime) : 0;
  const delta = actualDepartureMinutes !== null ? actualDepartureMinutes - scheduledDeptMin : nowMin - scheduledDeptMin;
  const isOnTime = Math.abs(delta) <= 1;
  const isAhead = delta > 1;

  const doneStops = stops.filter((s) => s.status === "done").length;
  const totalStops = stops.length;
  const progressPct = isRunning && totalStops > 1 ? Math.round((doneStops / (totalStops - 1)) * 100) : 0;
  const estimatedArrival = currentTrip ? minutesToTime(
    (actualDepartureMinutes ?? timeToMinutes(currentTrip.departureTime)) +
    (totalStops > 1 ? stops[totalStops - 1].minutesFromStart : 0)
  ) : "--:--";

  // ─── ЭКРАН: ПУТЕВОЙ ЛИСТ ───────────────────────────────────────────────────
  if (screen === "waybill") {
    return (
      <div className="min-h-screen bg-background text-foreground" style={{ fontFamily: "'Roboto', sans-serif" }}>
        <header className="sticky top-0 z-20 bg-card border-b border-border px-4 py-3 flex items-center justify-between shadow-xl">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-full bg-primary flex items-center justify-center shadow-lg">
              <Icon name="Bus" size={17} className="text-primary-foreground" />
            </div>
            <div>
              <div className="text-xs text-muted-foreground uppercase tracking-widest leading-none" style={{ fontFamily: "'Oswald', sans-serif" }}>
                Маршрут №18 · Астрахань
              </div>
              <div className="text-sm font-medium text-foreground leading-tight mt-0.5">
                Ввод путевого листа
              </div>
            </div>
          </div>
          <div className="text-2xl font-bold text-primary tabular-nums" style={{ fontFamily: "'Oswald', sans-serif" }}>
            {currentTime.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
          </div>
        </header>

        <div className="p-4 space-y-3 pb-24">
          <div className="text-xs text-muted-foreground uppercase tracking-widest flex items-center gap-1.5 mb-2" style={{ fontFamily: "'Oswald', sans-serif" }}>
            <Icon name="ClipboardList" size={12} />
            Рейсы на сегодня
          </div>

          {formTrips.map((trip, idx) => (
            <div key={idx} className="bg-card border border-border rounded-xl p-3">
              <div className="flex items-center gap-2 mb-3">
                <div className="w-7 h-7 rounded-full bg-primary/15 text-primary flex items-center justify-center text-sm font-bold flex-shrink-0" style={{ fontFamily: "'Oswald', sans-serif" }}>
                  {idx + 1}
                </div>
                <div className="flex-1 flex gap-2">
                  <button
                    onClick={() => updateFormTrip(idx, "direction", "forward")}
                    className={`flex-1 py-1.5 rounded-lg text-xs font-medium border transition-all ${
                      trip.direction === "forward"
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-muted text-muted-foreground border-border"
                    }`}
                  >
                    Добрострой → Садовских
                  </button>
                  <button
                    onClick={() => updateFormTrip(idx, "direction", "backward")}
                    className={`flex-1 py-1.5 rounded-lg text-xs font-medium border transition-all ${
                      trip.direction === "backward"
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-muted text-muted-foreground border-border"
                    }`}
                  >
                    Садовских → Добрострой
                  </button>
                </div>
              </div>
              <div className="flex gap-3">
                <div className="flex-1">
                  <div className="text-xs text-muted-foreground mb-1">Выезд</div>
                  <input
                    type="time"
                    value={trip.departureTime}
                    onChange={(e) => updateFormTrip(idx, "departureTime", e.target.value)}
                    className="w-full bg-background border border-border rounded-lg px-3 py-2.5 text-foreground text-lg font-bold tabular-nums focus:outline-none focus:border-primary"
                    style={{ fontFamily: "'Oswald', sans-serif" }}
                  />
                </div>
                <div className="flex-1">
                  <div className="text-xs text-muted-foreground mb-1">Прибытие</div>
                  <input
                    type="time"
                    value={trip.arrivalTime}
                    onChange={(e) => updateFormTrip(idx, "arrivalTime", e.target.value)}
                    className="w-full bg-background border border-border rounded-lg px-3 py-2.5 text-foreground text-lg font-bold tabular-nums focus:outline-none focus:border-primary"
                    style={{ fontFamily: "'Oswald', sans-serif" }}
                  />
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="fixed bottom-0 left-0 right-0 p-4 bg-background border-t border-border">
          <button
            onClick={handleSaveWaybill}
            className="w-full bg-primary text-primary-foreground py-4 rounded-xl font-bold text-lg active:scale-95 transition-transform shadow-lg shadow-primary/20 flex items-center justify-center gap-2"
            style={{ fontFamily: "'Oswald', sans-serif", letterSpacing: "0.06em" }}
          >
            <Icon name="CheckCircle" size={20} />
            СОХРАНИТЬ И К РЕЙСАМ
          </button>
        </div>
      </div>
    );
  }

  // ─── ЭКРАН: СПИСОК РЕЙСОВ ──────────────────────────────────────────────────
  if (screen === "tripList") {
    return (
      <div className="min-h-screen bg-background text-foreground" style={{ fontFamily: "'Roboto', sans-serif" }}>
        <header className="sticky top-0 z-20 bg-card border-b border-border px-4 py-3 flex items-center justify-between shadow-xl">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-full bg-primary flex items-center justify-center shadow-lg">
              <Icon name="Bus" size={17} className="text-primary-foreground" />
            </div>
            <div>
              <div className="text-xs text-muted-foreground uppercase tracking-widest leading-none" style={{ fontFamily: "'Oswald', sans-serif" }}>
                Маршрут №18 · Астрахань
              </div>
              <div className="text-sm font-medium text-foreground leading-tight mt-0.5">
                Рейсы на сегодня
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                setFormTrips(trips.length > 0
                  ? [...trips.map(t => ({ departureTime: t.departureTime, arrivalTime: t.arrivalTime, direction: t.direction })), ...Array.from({ length: Math.max(0, 10 - trips.length) }, emptyTrip)]
                  : Array.from({ length: 10 }, emptyTrip)
                );
                setScreen("waybill");
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border border-border bg-muted text-muted-foreground"
            >
              <Icon name="FileEdit" size={13} />
              Путевой лист
            </button>
            <div className="text-2xl font-bold text-primary tabular-nums" style={{ fontFamily: "'Oswald', sans-serif" }}>
              {currentTime.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
            </div>
          </div>
        </header>

        <div className="p-4 space-y-3 pb-6">
          <div className="text-xs text-muted-foreground uppercase tracking-widest flex items-center gap-1.5 mb-2" style={{ fontFamily: "'Oswald', sans-serif" }}>
            <Icon name="ListOrdered" size={12} />
            Нажми на рейс чтобы выехать
          </div>

          {trips.map((trip, idx) => {
            const depMin = timeToMinutes(trip.departureTime);
            const isPast = nowMin > timeToMinutes(trip.arrivalTime);
            const isNext = !isPast && nowMin <= depMin;
            const isCurrent = !isPast && nowMin > depMin;
            const minsToDepart = depMin - nowMin;

            return (
              <button
                key={trip.id}
                onClick={() => startTrip(idx)}
                disabled={isPast}
                className={`w-full text-left rounded-xl border p-4 transition-all active:scale-98 ${
                  isPast
                    ? "border-border/30 bg-card/20 opacity-40 cursor-default"
                    : isCurrent
                    ? "border-primary bg-primary/10 shadow-lg shadow-primary/15"
                    : "border-border bg-card hover:border-primary/40"
                }`}
              >
                <div className="flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center text-lg font-bold flex-shrink-0 ${
                    isPast ? "bg-muted text-muted-foreground" :
                    isCurrent ? "bg-primary text-primary-foreground" :
                    "bg-primary/15 text-primary"
                  }`} style={{ fontFamily: "'Oswald', sans-serif" }}>
                    {isPast ? <Icon name="Check" size={16} /> : trip.id}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className={`text-xl font-bold tabular-nums ${isCurrent ? "text-primary" : "text-foreground"}`} style={{ fontFamily: "'Oswald', sans-serif" }}>
                        {trip.departureTime}
                      </span>
                      <Icon name="ArrowRight" size={14} className="text-muted-foreground flex-shrink-0" />
                      <span className="text-xl font-bold tabular-nums text-foreground" style={{ fontFamily: "'Oswald', sans-serif" }}>
                        {trip.arrivalTime}
                      </span>
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      {trip.direction === "forward" ? "ТЦ Добрострой → ул. Садовских" : "ул. Садовских → ТЦ Добрострой"}
                    </div>
                  </div>

                  <div className="text-right flex-shrink-0">
                    {isPast && <span className="text-xs text-muted-foreground">Выполнен</span>}
                    {isCurrent && <span className="text-xs text-primary font-medium animate-pulse">В пути</span>}
                    {isNext && minsToDepart > 0 && (
                      <span className="text-xs text-blue-400">через {minsToDepart} мин</span>
                    )}
                    {isNext && minsToDepart <= 0 && (
                      <span className="text-xs text-accent font-medium">По графику</span>
                    )}
                    {!isPast && <Icon name="ChevronRight" size={16} className="text-muted-foreground mt-1 ml-auto" />}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  // ─── ЭКРАН: АКТИВНЫЙ РЕЙС ──────────────────────────────────────────────────
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
              Маршрут №18 · Рейс {currentTripIdx + 1}
            </div>
            <div className="text-sm font-medium text-foreground leading-tight mt-0.5">
              {currentTrip?.direction === "forward" ? "Добрострой → Садовских" : "Садовских → Добрострой"}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setVoiceEnabled(!voiceEnabled)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${
              voiceEnabled ? "bg-accent/15 text-accent border-accent/40" : "bg-muted text-muted-foreground border-border"
            }`}
          >
            <Icon name={voiceEnabled ? "Volume2" : "VolumeX"} size={13} />
            {voiceEnabled ? "Звук" : "Тихо"}
          </button>
          <div className="text-2xl font-bold text-primary tabular-nums" style={{ fontFamily: "'Oswald', sans-serif" }}>
            {currentTime.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
          </div>
        </div>
      </header>

      {/* Status bar */}
      <div className={`px-4 py-2 flex items-center justify-between text-sm font-medium border-b border-border ${
        isOnTime ? "bg-accent/10 text-accent" : isAhead ? "bg-blue-500/10 text-blue-400" : "bg-destructive/10 text-destructive"
      }`}>
        <div className="flex items-center gap-2">
          <Icon name={isOnTime ? "CheckCircle" : isAhead ? "TrendingUp" : "AlertTriangle"} size={15} />
          <span>{getDeltaLabel(delta)}</span>
        </div>
        <span className="text-xs text-muted-foreground">
          Прибытие: <strong className="text-foreground">{estimatedArrival}</strong>
        </span>
      </div>

      {/* Progress bar */}
      <div className="h-1.5 bg-muted">
        <div className="h-full bg-primary transition-all duration-1000" style={{ width: `${progressPct}%` }} />
      </div>

      {/* Control panel */}
      <div className="px-4 py-3 bg-card/50 border-b border-border flex items-center justify-between">
        <div>
          <div className="text-xs text-muted-foreground uppercase tracking-widest" style={{ fontFamily: "'Oswald', sans-serif" }}>
            Маршрут активен
          </div>
          <div className="text-sm text-foreground mt-0.5">
            Выехал в <strong className="text-primary">{minutesToTime(actualDepartureMinutes!)}</strong>
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

      {/* Stops list */}
      <div className="flex-1 overflow-y-auto p-4 space-y-2 pb-6">
        <div className="text-xs text-muted-foreground uppercase tracking-widest mb-3 flex items-center gap-1.5" style={{ fontFamily: "'Oswald', sans-serif" }}>
          <Icon name="MapPin" size={12} />
          Остановки · {totalStops} всего
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
                isCurrent ? "border-primary bg-primary/10 shadow-lg shadow-primary/10"
                : isDone ? "border-border/40 bg-card/30 opacity-60"
                : isDelayed ? "border-destructive/30 bg-destructive/5"
                : "border-border bg-card/60"
              }`}
            >
              <div className={`w-1 flex-shrink-0 ${
                isCurrent ? "bg-primary"
                : isDone ? "bg-accent/40"
                : isDelayed ? "bg-destructive/60"
                : isFirst ? "bg-blue-500/60"
                : isLast ? "bg-red-500/60"
                : "bg-border"
              }`} />

              <div className="flex-1 flex items-center gap-3 px-3 py-3">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0 ${
                  isCurrent ? "bg-primary text-primary-foreground"
                  : isDone ? "bg-accent/20 text-accent"
                  : isFirst ? "bg-blue-500/20 text-blue-400"
                  : isLast ? "bg-red-500/20 text-red-400"
                  : "bg-muted text-muted-foreground"
                }`} style={{ fontFamily: "'Oswald', sans-serif" }}>
                  {isDone ? <Icon name="Check" size={14} /> : stop.id}
                </div>

                <div className="flex-1 min-w-0">
                  <div className={`font-medium text-sm leading-tight ${
                    isCurrent ? "text-primary" : isDone ? "text-muted-foreground" : "text-foreground"
                  }`}>
                    {stop.name}
                  </div>
                  {(isFirst || isLast) && (
                    <div className={`text-xs mt-0.5 ${isFirst ? "text-blue-400" : "text-red-400"}`}>
                      {isFirst ? "Начальная" : "Конечная"}
                    </div>
                  )}
                </div>

                <div className="text-right flex-shrink-0">
                  <div className={`text-xl font-bold tabular-nums ${
                    isCurrent ? "text-primary" : isDone ? "text-muted-foreground" : isDelayed ? "text-destructive" : "text-foreground"
                  }`} style={{ fontFamily: "'Oswald', sans-serif" }}>
                    {stop.scheduledTime}
                  </div>
                  {isDelayed && !isDone && (
                    <div className="text-xs text-destructive">отставание</div>
                  )}
                </div>

                {isCurrent && (
                  <div className="absolute right-3 top-1/2 -translate-y-1/2 w-2.5 h-2.5 rounded-full bg-primary animate-pulse" />
                )}
              </div>
            </div>
          );
        })}

        {/* Итог рейса */}
        {currentTrip && (
          <div className="mt-4 grid grid-cols-3 gap-2">
            {[
              { label: "Отправление", value: currentTrip.departureTime, icon: "PlayCircle" },
              { label: "В пути", value: `${stops.length > 1 ? stops[stops.length - 1].minutesFromStart : 0} мин`, icon: "Clock" },
              { label: "Прибытие", value: currentTrip.arrivalTime, icon: "StopCircle" },
            ].map((item) => (
              <div key={item.label} className="bg-card border border-border rounded-xl p-3 text-center">
                <Icon name={item.icon} size={14} className="text-muted-foreground mx-auto mb-1" />
                <div className="text-lg font-bold text-primary tabular-nums" style={{ fontFamily: "'Oswald', sans-serif" }}>
                  {item.value}
                </div>
                <div className="text-xs text-muted-foreground mt-0.5">{item.label}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}