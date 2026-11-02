// Walkthroughs for moving from the biggest bankroll trackers (owner, 2026-11-01: "simple walkthroughs for
// the 3-4 biggest bankroll trackers"). Pokerbase, Poker Analytics, Poker Bankroll Tracker and Poker Income
// are the four the reviews name (PokerNews "The Top 5 Best Poker Bankroll Trackers"; pokerfuse).
//
// Every export step below is sourced, and only Poker Bankroll Tracker publishes its file's columns, so it
// alone is recognised on sight (utils/bankroll-csv.js PRESETS); the others go through the column matching.
// Sources, checked 2026-11-01:
//   PBT          poker-analytics.net/switch/poker-bankroll-tracker.html (menu, user icon, Export to CSV);
//                its App Store listing (CSV export and import are Pro features); the file's first line and
//                columns: pokerbankrolltracker.net/faq and PBT_Bankroll_CSV_example.csv.
//   Pokerbase    poker-analytics.net/switch/pokerbase.html (More, CSV Export, Generate report).
//   Poker Analytics  its FAQ (sessions export to CSV; XML is the app's own backup) and release notes
//                (Android 2.4: More tab; iOS 5.2: the Feed's Sessions tab).
//   Poker Income poker-analytics.net/switch/poker-income.html (Setup, Export Data, All (Comma separated),
//                an email; sometimes the rows land in the email body).
// Menu names are the apps' own and can move between versions; each guide says what to look for.

export const IMPORT_GUIDES = [
  {
    id: 'pbt',
    tab: 'PBT',
    name: 'Poker Bankroll Tracker',
    steps: [
      'In Poker Bankroll Tracker, tap the menu at the top left, then the small user icon at the bottom of the menu.',
      'Choose Export to CSV, and save the file or email it to yourself. CSV export is part of PBT Pro.',
      'Here, choose the file. It is recognised on sight: tournaments, cash sessions and deposits or payouts come in; costs, casino games and jackpots are left out.',
    ],
    recognised: true,
  },
  {
    id: 'pokerbase',
    tab: 'Pokerbase',
    name: 'Pokerbase',
    steps: [
      'In Pokerbase, open the More tab and choose CSV Export.',
      'Tap Generate report, then save it to Files or email it to yourself.',
      'Here, choose the file and match its columns. If one column says cash or tournament, pick “Both” and map it as the type.',
    ],
  },
  {
    id: 'poker-analytics',
    tab: 'Analytics',
    name: 'Poker Analytics',
    steps: [
      'In Poker Analytics, open the More tab and look for Export. On older iPhone versions it sits under the Feed’s Sessions tab.',
      'Choose the CSV export of your sessions, not XML (XML is the app’s own backup format).',
      'Here, choose the file and match its columns. If one column says cash or tournament, pick “Both” and map it as the type.',
    ],
  },
  {
    id: 'poker-income',
    tab: 'Income',
    name: 'Poker Income',
    steps: [
      'In Poker Income, open the Setup tab and tap Export Data.',
      'Choose All (Comma separated). It opens an email: send it to yourself and save the attached file.',
      'If the rows arrive in the body of the email instead, paste them into a plain text file and save it with a .csv ending.',
      'Here, choose the file and match its columns. If one column says cash or tournament, pick “Both” and map it as the type.',
    ],
  },
];
