import { hasSupabase } from "@/lib/record";

/** Shown once in the shell when running keyless. German first, per repo rule. */
export function RecordModeNotice() {
  if (hasSupabase) return null;
  return (
    <div className="w-full bg-[#00498B] px-4 py-2 text-center text-sm text-white">
      Öffentlicher Datensatz – nur Lesen. Diese Instanz läuft ohne Backend und
      zeigt das öffentliche Register der Stadt.
    </div>
  );
}
