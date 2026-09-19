import assert from "node:assert/strict";
import test from "node:test";
import { departmentSummaryText } from "./departments";

test("reading a department response removes its repeated labels but preserves assumptions and limits", () => {
  const text = "Simulierte Fachantwort zum Bürgerrat-Test: Das Kostenmodell ergibt A 16.600 Euro, B 34.500 Euro.\nEmpfehlung im Test: A bevorzugen.\nNächster Schritt: Reale Finanzierung klären; eine Zusage fehlt.";
  assert.equal(departmentSummaryText(text), "Das Kostenmodell ergibt A 16.600 Euro, B 34.500 Euro.\nEmpfehlung: A bevorzugen.\nNächster Schritt: Reale Finanzierung klären; eine Zusage fehlt.");
  assert.ok(text.startsWith("Simulierte Fachantwort"));
  for (const original of ["Eine Simulation ersetzt keine Standortprüfung.", "Test: A ist nur unter diesen Annahmen günstiger.", "Empfehlung: Zuerst den Test auswerten."]) {
    assert.equal(departmentSummaryText(original), original);
  }
});
