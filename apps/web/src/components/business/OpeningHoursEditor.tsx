"use client"

import type { OpeningHours } from "@/types/business"
import { DAYS_OF_WEEK } from "@/types/business"

interface OpeningHoursEditorProps {
  value: OpeningHours
  onChange: (hours: OpeningHours) => void
  disabled?: boolean
}

export function OpeningHoursEditor({
  value,
  onChange,
  disabled = false,
}: OpeningHoursEditorProps) {
  const handleTimeChange = (
    day: string,
    field: "open" | "close",
    time: string,
  ) => {
    if (disabled) return
    onChange({
      ...value,
      [day]: {
        ...value[day],
        [field]: time,
        closed: false,
      },
    })
  }

  const handleClosedToggle = (day: string) => {
    if (disabled) return
    const current = value[day]
    if (current?.closed) {
      onChange({
        ...value,
        [day]: { open: "09:00", close: "18:00", closed: false },
      })
    } else {
      onChange({
        ...value,
        [day]: { open: "", close: "", closed: true },
      })
    }
  }

  return (
    <div className="space-y-2">
      <label className="block text-sm font-medium text-foreground">Öffnungszeiten</label>
      <div className="space-y-2">
        {DAYS_OF_WEEK.map((day) => {
          const entry = value[day.value]
          const isClosed = entry?.closed ?? !entry

          return (
            <div key={day.value} className="flex items-center gap-3">
              <span className="w-24 text-sm text-foreground font-medium">{day.label}</span>

              <label
                className={`flex items-center gap-1.5 ${disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer"}`}
              >
                <input
                  type="checkbox"
                  checked={!isClosed}
                  onChange={() => handleClosedToggle(day.value)}
                  disabled={disabled}
                  className="rounded border-border text-primary focus:ring-ring"
                />
                <span className="text-xs text-muted-foreground">Geöffnet</span>
              </label>

              {!isClosed && (
                <div className="flex items-center gap-1.5">
                  <input
                    type="time"
                    value={entry?.open || "09:00"}
                    onChange={(e) => handleTimeChange(day.value, "open", e.target.value)}
                    disabled={disabled}
                    className="px-2 py-1 text-sm border border-border rounded focus:outline-none focus:ring-1 focus:ring-ring"
                  />
                  <span className="text-muted-foreground text-sm">–</span>
                  <input
                    type="time"
                    value={entry?.close || "18:00"}
                    onChange={(e) => handleTimeChange(day.value, "close", e.target.value)}
                    disabled={disabled}
                    className="px-2 py-1 text-sm border border-border rounded focus:outline-none focus:ring-1 focus:ring-ring"
                  />
                </div>
              )}

              {isClosed && (
                <span className="text-xs text-muted-foreground">Geschlossen</span>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
