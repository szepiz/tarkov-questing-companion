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
  // "From Hand to Hand" (was Lend-Lease - Part 2). Both sources say Peacekeeper.
  // Reported from the game 2026-08-05: it is Skier's now.
  '5c0d0f1886f77457b8210226': 'Skier',
};

// Renames the wiki has not made yet. wikinames.js harvests the wiki's page
// moves, which covers 91 quests; these are the ones reported from the game
// before an editor got to them. Applied after wikinames.js, so it wins.
const QUEST_NAMES = {
  // Reported from the game 2026-08-05. The wiki page is still under the old
  // title with no redirect, so build_wikinames.js cannot see it yet.
  '5d25e44386f77409453bce7b': 'The Huntsman Path - Angry Watchman',
};

if (typeof module !== 'undefined') module.exports = { QUEST_TRADERS, QUEST_NAMES };
