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
const NO_LEVEL = {
  // "Swift" (Jaeger). tarkov.dev and the wiki both say level 50. Reported from
  // the game 2026-08-05 by a player who is exactly level 40 and has it in their
  // active task list — so whatever gates it now, it is not the level. Jaeger
  // was at loyalty 4, which is the likely replacement.
  '60e729cf5698ee7b05057439': true,
};

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
const EXTRA_QUESTS = [
  {
    id: 'hand:fall-ailment', name: 'Fall Ailment', trader: 'Therapist',
    objectives: ['Find 5 Disposable syringe in raid', 'Hand over the items'],
  },
  {
    id: 'hand:the-tarkov-butcher', name: 'The Tarkov Butcher', trader: 'Therapist',
    map: 'Ground Zero',
    objectives: ['Locate and obtain the chemical container on Ground Zero',
      'Stash the container by the police station on Streets of Tarkov'],
  },
  // No wiki page exists for these three. Trader is what the owner saw in game.
  // Woods reported from the game 2026-08-05, off the in-game task list's own
  // Location column. Without a map a hand-added quest files under "Anywhere",
  // which is where this one was hiding while the owner was looking at Woods.
  { id: 'hand:hiking', name: 'Hiking', trader: 'Peacekeeper', map: 'Woods', objectives: [] },
  { id: 'hand:secret-message', name: 'Secret Message', trader: 'Peacekeeper', objectives: [] },
  { id: 'hand:demonstration-model', name: 'Demonstration Model', trader: 'Peacekeeper', objectives: [] },
];

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
  module.exports = { QUEST_TRADERS, QUEST_NAMES, NO_LEVEL, EXTRA_QUESTS, MANUAL_ONLY };
}
