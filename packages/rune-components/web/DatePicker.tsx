/** @jsxImportSource solid-js */
import { createSignal, createEffect, For, Show, createMemo, onCleanup } from "solid-js";
import { registerComponent } from "./utils";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"
];

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export const DatePicker = (props: any) => {
  const [visible, setVisible] = createSignal(false);
  const [viewMode, setViewMode] = createSignal<"month" | "year">("month");
  const [viewDate, setViewDate] = createSignal(new Date());
  
  // Selection state
  const value = () => props.value;
  const mode = () => props.mode || "date";

  createEffect(() => {
    const cmd = props.__command;
    if (!cmd) return;
    if (cmd.type === "show") {
      setVisible(true);
      setViewMode(mode() === "year" ? "year" : "month");
    }
    if (cmd.type === "dismiss") setVisible(false);
  });

  const handleDayClick = (date: Date) => {
    if (mode() === "range") {
      const current = (value() as any) || { start: null, end: null };
      if (!current.start || (current.start && current.end)) {
        props.onRangeChange?.({ start: date.getTime(), end: null });
      } else {
        const start = current.start;
        const end = date.getTime();
        if (end < start) {
          props.onRangeChange?.({ start: end, end: start });
        } else {
          props.onRangeChange?.({ start, end });
        }
      }
    } else {
      props.onChange?.(date.getTime());
      setVisible(false);
    }
  };

  const handleYearClick = (year: number) => {
    const d = new Date(viewDate());
    d.setFullYear(year);
    if (mode() === "year") {
      props.onChange?.(d.getTime());
      setVisible(false);
    } else {
      setViewDate(d);
      setViewMode("month");
    }
  };

  const calendarCells = createMemo(() => {
    const d = viewDate();
    const year = d.getFullYear();
    const month = d.getMonth();
    const firstDay = new Date(year, month, 1).getDay();
    const lastDate = new Date(year, month + 1, 0).getDate();
    
    const cells = [];
    
    // Padding from previous month
    const prevMonthLastDate = new Date(year, month, 0).getDate();
    for (let i = firstDay - 1; i >= 0; i--) {
      cells.push({ 
        date: new Date(year, month - 1, prevMonthLastDate - i), 
        isCurrentMonth: false 
      });
    }
    
    // Current month days
    for (let i = 1; i <= lastDate; i++) {
      cells.push({ 
        date: new Date(year, month, i), 
        isCurrentMonth: true 
      });
    }
    
    // Padding from next month to fill 6 rows (42 cells)
    const remaining = 42 - cells.length;
    for (let i = 1; i <= remaining; i++) {
      cells.push({ 
        date: new Date(year, month + 1, i), 
        isCurrentMonth: false 
      });
    }
    
    return cells;
  });

  const isSelected = (date: Date) => {
    if (!date) return false;
    const v = value();
    if (mode() === "range") {
      const range = v || { start: null, end: null };
      return date.getTime() === range.start || date.getTime() === range.end;
    }
    return v && new Date(v).toDateString() === date.toDateString();
  };

  const isInRange = (date: Date) => {
    if (!date || mode() !== "range") return false;
    const range = value() || { start: null, end: null };
    if (!range.start || !range.end) return false;
    const t = date.getTime();
    return t > range.start && t < range.end;
  };

  const changeMonth = (delta: number) => {
    const d = new Date(viewDate());
    d.setMonth(d.getMonth() + delta);
    setViewDate(d);
  };

  return (
    <div style="display: contents">
      {/* Trigger Slot */}
      <div 
        data-rune-slot 
        style="display: contents" 
        onClick={() => setVisible(true)}
      />

      <Show when={visible()}>
        <div 
          style={{
            position: "fixed",
            top: 0, left: 0, right: 0, bottom: 0,
            "background-color": "rgba(0,0,0,0.5)",
            display: "flex",
            "align-items": "center",
            "justify-content": "center",
            "z-index": 2000,
          }}
          onClick={() => { setVisible(false); props.onDismiss?.(); }}
        >
          <div 
            style={{
              "background-color": "white",
              "border-radius": "28px",
              width: "328px",
              padding: "20px",
              display: "flex",
              "flex-direction": "column",
              "box-shadow": "0 10px 25px rgba(0,0,0,0.2)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div style={{ "margin-bottom": "16px" }}>
              <div style={{ "font-size": "14px", "font-weight": "500", color: "#49454f" }}>
                {props.title || (mode() === "range" ? "Select range" : "Select date")}
              </div>
            </div>

            <Show 
              when={viewMode() === "month"}
              fallback={
                <div style={{ height: "300px", "overflow-y": "auto", display: "grid", "grid-template-columns": "repeat(3, 1fr)", gap: "8px", padding: "8px 0" }}>
                  <For each={Array.from({ length: 100 }, (_, i) => new Date().getFullYear() + 10 - i)}>
                    {(year) => (
                      <div 
                        onClick={() => handleYearClick(year)}
                        style={{
                          padding: "10px",
                          "text-align": "center",
                          cursor: "pointer",
                          "border-radius": "20px",
                          "background-color": viewDate().getFullYear() === year ? "#6750a4" : "transparent",
                          color: viewDate().getFullYear() === year ? "white" : "inherit"
                        }}
                      >
                        {year}
                      </div>
                    )}
                  </For>
                </div>
              }
            >
              {/* Calendar Controls */}
              <div style={{ display: "flex", "align-items": "center", "justify-content": "space-between", "margin-bottom": "12px" }}>
                <div 
                  onClick={() => setViewMode("year")}
                  style={{ "font-weight": "600", "font-size": "14px", cursor: "pointer", display: "flex", "align-items": "center", gap: "4px" }}
                >
                  {MONTHS[viewDate().getMonth()]} {viewDate().getFullYear()}
                  <span style={{ "font-size": "10px" }}>▼</span>
                </div>
                <div>
                  <button onClick={() => changeMonth(-1)} style={{ border: "none", background: "none", cursor: "pointer", padding: "8px" }}>←</button>
                  <button onClick={() => changeMonth(1)} style={{ border: "none", background: "none", cursor: "pointer", padding: "8px" }}>→</button>
                </div>
              </div>

              {/* Grid Header */}
              <div style={{ display: "grid", "grid-template-columns": "repeat(7, 1fr)", "margin-bottom": "8px" }}>
                <For each={DAYS}>
                  {(day) => <div style={{ "text-align": "center", "font-size": "12px", color: "#49454f" }}>{day}</div>}
                </For>
              </div>

              {/* Grid Days */}
              <div style={{ display: "grid", "grid-template-columns": "repeat(7, 1fr)", gap: "4px" }}>
                <For each={calendarCells()}>
                  {(cell) => (
                    <div 
                      onClick={() => cell.isCurrentMonth && handleDayClick(cell.date)}
                      style={{
                        height: "40px",
                        display: "flex",
                        "align-items": "center",
                        "justify-content": "center",
                        cursor: cell.isCurrentMonth ? "pointer" : "default",
                        "font-size": "14px",
                        "border-radius": "50%",
                        "background-color": cell.isCurrentMonth && isSelected(cell.date) ? "#6750a4" : (cell.isCurrentMonth && isInRange(cell.date) ? "#eaddff" : "transparent"),
                        color: cell.isCurrentMonth && isSelected(cell.date) ? "white" : (cell.isCurrentMonth ? "inherit" : "#ccc"),
                        opacity: 1
                      }}
                    >
                      {cell.date.getDate()}
                    </div>
                  )}
                </For>
              </div>
            </Show>

            {/* Footer */}
            <div style={{ display: "flex", "justify-content": "flex-end", "margin-top": "24px", gap: "8px" }}>
              <button 
                onClick={() => { setVisible(false); props.onCancel?.(); }}
                style={{ border: "none", background: "none", color: "#6750a4", "font-weight": "500", cursor: "pointer", padding: "10px" }}
              >
                {props.cancelText || "Cancel"}
              </button>
              <button 
                onClick={() => { setVisible(false); props.onDismiss?.(); }}
                style={{ border: "none", background: "none", color: "#6750a4", "font-weight": "500", cursor: "pointer", padding: "10px" }}
              >
                {props.confirmText || "OK"}
              </button>
            </div>
          </div>
        </div>
      </Show>
    </div>
  );
};

registerComponent("date-picker-view", DatePicker);
registerComponent("date-picker-trigger-view", (props) => (
  <div data-rune-slot style="display: contents" {...props} />
));
