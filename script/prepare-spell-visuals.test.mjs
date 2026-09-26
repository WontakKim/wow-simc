import assert from "node:assert/strict";
import { test } from "node:test";
import { prepareSpellVisuals, resolveSpellVisualGraph } from "./prepare-spell-visuals.mjs";

test("prepares typed visual alternatives without conflating effect IDs with model IDs", () => {
  const rows = {
    SpellXSpellVisual: [
      { ID: "1", SpellID: "51505", SpellVisualID: "10", CasterPlayerConditionID: "52517", Priority: "1" },
      { ID: "2", SpellID: "51505", SpellVisualID: "11", CasterPlayerConditionID: "52518", Priority: "0" },
    ],
    SpellVisual: [{ ID: "10", SpellVisualMissileSetID: "20", MissileDestinationAttachment: "34" }, { ID: "11", SpellVisualMissileSetID: "0" }],
    SpellVisualEvent: [{ ID: "30", SpellVisualID: "10", SpellVisualKitID: "40", StartEvent: "1", EndEvent: "2", TargetType: "1", StartMinOffsetMs: "-20", StartMaxOffsetMs: "20" }],
    SpellVisualKit: [{ ID: "40", DelayMin: "0", DelayMax: "0" }],
    SpellVisualKitEffect: [{ ID: "50", ParentSpellVisualKitID: "40", EffectType: "2", Effect: "60" }, { ID: "51", ParentSpellVisualKitID: "40", EffectType: "6", Effect: "80" }, { ID: "52", ParentSpellVisualKitID: "40", EffectType: "5", Effect: "999" }],
    SpellVisualKitModelAttach: [{ ID: "60", SpellVisualEffectNameID: "70", AttachmentID: "22", Offset_1: "0.15", Pitch: "1.57", Scale: "1", StartDelay: "0.2" }],
    SpellVisualEffectName: [{ ID: "70", ModelFileDataID: "1284864" }],
    SpellVisualMissile: [{ ID: "90", SpellVisualMissileSetID: "20", SpellVisualEffectNameID: "70", Attachment: "34", DestinationAttachment: "34", CastOffset_0: "-7" }],
    SpellVisualAnim: [{ ID: "80", InitialAnimID: "51", LoopAnimID: "52", AnimKitID: "100" }],
    AnimKit: [{ ID: "100", OneShotDuration: "200" }],
    AnimKitSegment: [{ ID: "101", ParentAnimKitID: "100", OrderIndex: "0", AnimID: "53" }],
  };
  const graph = resolveSpellVisualGraph(rows, { 51505: 10 }, [51505]);
  assert.equal(graph.spells[51505].alternatives.length, 2);
  assert.equal(graph.spells[51505].alternatives[0].CasterPlayerConditionID, 52517);
  assert.equal(graph.visuals[10].events[0].StartMinOffsetMs, -20);
  const effects = graph.visuals[10].events[0].kit.effects;
  assert.equal(effects[0].modelAttach.effectName.ModelFileDataID, 1284864);
  assert.equal(effects[0].modelAttach.Offset_1, 0.15);
  assert.equal(effects[1].visualAnim.animKit.segments[0].AnimID, 53);
  assert.equal(effects[2].effectName, undefined);
  assert.equal(graph.visuals[10].missiles[0].CastOffset_0, -7);
  assert.equal(graph.visuals[10].missiles[0].effectName.ModelFileDataID, 1284864);
});

test("rejects source CSV drift before writing a prepared visual graph", async () => {
  await assert.rejects(prepareSpellVisuals({ fetchText: async () => "ID,SpellID\n1,51505\n" }),
    /SpellXSpellVisual 12\.1\.0\.69933 CSV SHA-256 mismatch/);
});
