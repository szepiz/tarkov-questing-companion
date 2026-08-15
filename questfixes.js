// HAND-MAINTAINED. Corrections reported from the GAME ITSELF, for cases where
// both data sources are wrong and neither is going to notice.
//
// This is the third tier of the data hierarchy, and the same one
// `map_annotations.json` occupies: json.tarkov.dev is the record, the wiki
// overlays what the patch changed, and this file holds what the owner has read
// off their own screen. Nothing here is derived or guessed — every entry names
// the date it was reported and what the other sources claim, so a future run
// can tell whether they have caught up and the row can be dropped.
//
// Keyed by task ID, which never changes, so nothing here can affect progress.

// Quests handed out by a different trader than either source says.
// 1.1.0 moved some quests between traders. The wiki's `given by` agreed with
// tarkov.dev on 521 of 526 quests when this was measured, so it does not know
// about these either.
const QUEST_TRADERS = {
  // Empty since 2026-08-11, and that is the system working.
  //
  // It held "From Hand to Hand" (was Lend-Lease - Part 2), reported from the
  // game on 2026-08-05 as Skier's where both sources said Peacekeeper. The app
  // now reads its quest data from our own API, which carries that observation,
  // so the row agreed with its own input and was deleted. A correction that
  // corrects nothing reads like a live finding and hides the ones that are.
};

// Quests 1.1.0 MOVED TO A DIFFERENT MAP. tarkov.dev still files them where they
// used to be, and the wiki's infobox `|location =` is stale on these too — but
// the wiki's OBJECTIVE line names the real map, which is how these are found:
// compare `task.map` against the maps linked in the wiki's ==Objectives==
// section and look at every disagreement by hand.
//
// The value replaces the task's map AND retags any objective still carrying the
// old one, so the row, the details panel and the map screen cannot disagree.
// An ARRAY means the quest allows several maps: the task then carries none and
// the objectives list them, which is how every other multi-map quest reads.
//
// ⚠️ A map move DROPS the objective's coordinates rather than relabelling them.
// A zone position is a point on the OLD map and means nothing on the new one —
// relabelling would scatter pins across the wrong map at plausible-looking
// spots. Neither row below has any coordinates (both are `shoot` objectives, 0
// zones and 0 locations), so nothing is lost today; the rule is here for the
// first row that does.
const QUEST_MAPS = {
  // "Decontamination Service" was here until 2026-08-11, moved to The Lab from
  // Interchange. The published API now carries that observation, so the row
  // agreed with its input and was removed.
  //
  // "Easy-Breezy" (Prapor, was Test Drive - Part 5). BOTH sources say Factory
  // and agree with each other, which is the case this file exists for:
  // tarkov.dev has `map: Factory` and objective maps Night Factory + Factory,
  // and the wiki says Factory in its infobox AND in its objective line — the
  // LIVE page, re-read 2026-08-10, not the cached copy. Reported from the game
  // the same day: it is Reserve or Lighthouse now.
  //
  // ⚠️ Recorded as the owner phrased it — the two maps the quest allows. If it
  // turns out to be only ONE of them, this is a one-word edit to that map, and
  // it should be made rather than left listing a raid you cannot do it on.
  '669fa3a40c828825de06d6a1': ['Reserve', 'Lighthouse'],

  // "Job for a Patriot" (Prapor). Read off the game screen 2026-08-10: Streets,
  // Ground Zero and Shoreline. tarkov.dev publishes Lighthouse, Customs and
  // Reserve — three different maps, not a subset — and the two lists disagreeing
  // in full is why the merge leaves `map: null` and the app files it under
  // Anywhere, where it appears on no map screen at all.
  //
  // Its one objective is a `shoot` with no zones and no positions, so this
  // relabels a row rather than moving any pin.
  '64f5deac39e45b527a7c4232': ['Streets of Tarkov', 'Ground Zero', 'Shoreline'],
};

// Renames the wiki has not made yet. wikinames.js harvests the wiki's page
// moves, which covers 92 quests; these are the ones reported from the game
// before an editor got to them. Applied after wikinames.js, so it wins.
//
// Empty as of 2026-08-05: its only row was "The Huntsman Path - Evil Watchman"
// -> "Angry Watchman", reported from the game on Aug 5 while the wiki page was
// still under the old title. A re-harvest the same day found the page had been
// moved and the redirect left behind, so wikinames.js now carries it and the
// row corrected nothing. `test_wikinames.js` fails a row that agrees with
// either source, so this list cannot quietly accumulate dead overrides.
const QUEST_NAMES = {};

// Player-level requirements 1.1.0 dropped, reported from the GAME. wikireqs.js
// already removes 73 of these where the wiki's own Requirements section lists a
// loyalty gate and no level; this list is for the ones where the wiki is still
// carrying the old number too, so that harvest cannot see them.
// EMPTY since 2026-08-15, and that is the point: every row here was a claim
// that a published level gate was wrong, and the sources have caught up.
//
// "Swift" (Jaeger) was the last one. Both tarkov.dev and the wiki published a
// level 50 gate on a quest a level-40 player had active, reported from the game
// 2026-08-05. tarkov.dev's 1.1.0 correction publishes no level for it at all, so
// the row had nothing left to remove and `test_wikinames.js` flagged it as
// redundant. A row that removes nothing is worse than no row: it reads as a
// live correction and hides that the argument is over.
//
// Add one only when a source publishes a level the game contradicts.
const NO_LEVEL = {};

// Quests patch 1.1.0 ADDED that tarkov.dev has never published. Reported from
// the game 2026-08-05; the first two also have wiki pages, so their objectives
// and requirements are real. The last three have no page anywhere — name and
// trader are all that is known, and saying so beats leaving them out.
//
// ⚠️ The ids are ours, not the game's. A hand-added quest cannot tick itself
// from the logs, because the log carries BSG's id and we have no way to learn
// which one it is. They are tick-by-hand entries until tarkov.dev publishes
// them, at which point these rows must be DELETED rather than left to sit
// alongside the real thing.
//
// ⚠️ **Kings of the Rooftops was removed 2026-08-05 — it was never missing.**
// tarkov.dev had it all along (639136f086e646067c176a8b, Prapor, Streets,
// level 22), so from v1.36.0 the list carried it TWICE and one copy could not
// tick. Nothing is lost: wikireqs.js already holds its Prapor LL2 gate against
// the real id. These notes claimed test_wikinames.js failed a row whose name
// had appeared in the quest data — it did not; no such check existed, which is
// exactly why this went unnoticed. It exists now, so check the test rather than
// eyeballing the API before adding anything here.
// Quests the game has that no published source did. Empty since 2026-08-11.
//
// All five (Fall Ailment, The Tarkov Butcher, Hiking, Secret Message,
// Demonstration Model) now arrive from our own API under `observed:` ids,
// because they are in the observation set it is built from. Leaving the
// `hand:` rows here would list every one of them TWICE.
//
// Nothing had progress recorded against a `hand:` id, so deleting them orphans
// nothing. Add a row here only for a quest the API does NOT carry.
const EXTRA_QUESTS = [];

// Quests that can NEVER tick themselves, beyond the hand-added ones above
// (which cannot by construction — the log carries BSG's id and these carry
// ours). A quest belongs here only when it is KNOWN to write no completion
// message, not when it merely has not written one yet.
//
// The obvious candidates are Ref's Arena-side quests, where 8 of the 21 do
// write and the rest do not. Which 8 is not recorded anywhere, and marking all
// 21 would tell you to watch quests that tick themselves fine — so the line
// stays out until the split is known. Add ids here as they are confirmed.
const MANUAL_ONLY = [];

if (typeof module !== 'undefined') {
  module.exports = { QUEST_TRADERS, QUEST_MAPS, QUEST_NAMES, NO_LEVEL, EXTRA_QUESTS, MANUAL_ONLY };
}
