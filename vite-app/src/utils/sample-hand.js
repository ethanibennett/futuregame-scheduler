// A bundled 6-max hand for the empty Hands list (UX pick 70): "Watch a sample hand" opens it read-only,
// so a new player can see what a replay is before entering one of their own. The hand is the hand-history
// suite's first fixture (test/hh-io/fixtures/01-nlh-cash-3bet.json): a 3-bet pot, a showdown, a ship.
export const SAMPLE_HAND = {
  "gameType": "NLH",
  "gameMode": "cash",
  "currency": "USD",
  "blinds": {
    "sb": 1,
    "bb": 2,
    "ante": 0
  },
  "players": [
    {
      "name": "Lena",
      "position": "LJ",
      "startingStack": 200
    },
    {
      "name": "Marco",
      "position": "HJ",
      "startingStack": 200
    },
    {
      "name": "Dee",
      "position": "CO",
      "startingStack": 200
    },
    {
      "name": "Ethan",
      "position": "BTN",
      "startingStack": 250
    },
    {
      "name": "Sol",
      "position": "SB",
      "startingStack": 200
    },
    {
      "name": "Rafe",
      "position": "BB",
      "startingStack": 200
    }
  ],
  "heroIdx": 3,
  "streets": [
    {
      "name": "Preflop",
      "cards": {
        "hero": "AsKd",
        "opponents": [
          "",
          "QhQc",
          "",
          "",
          ""
        ],
        "board": ""
      },
      "actions": [
        {
          "player": 0,
          "action": "fold",
          "amount": 0
        },
        {
          "player": 1,
          "action": "raise",
          "amount": 6
        },
        {
          "player": 2,
          "action": "fold",
          "amount": 0
        },
        {
          "player": 3,
          "action": "raise",
          "amount": 20
        },
        {
          "player": 4,
          "action": "fold",
          "amount": 0
        },
        {
          "player": 5,
          "action": "fold",
          "amount": 0
        },
        {
          "player": 1,
          "action": "call",
          "amount": 14
        }
      ],
      "draws": []
    },
    {
      "name": "Flop",
      "cards": {
        "hero": "",
        "opponents": [
          "",
          "",
          "",
          "",
          ""
        ],
        "board": "Ks7d2c"
      },
      "actions": [
        {
          "player": 1,
          "action": "check",
          "amount": 0
        },
        {
          "player": 3,
          "action": "bet",
          "amount": 22
        },
        {
          "player": 1,
          "action": "call",
          "amount": 22
        }
      ],
      "draws": []
    },
    {
      "name": "Turn",
      "cards": {
        "hero": "",
        "opponents": [
          "",
          "",
          "",
          "",
          ""
        ],
        "board": "9h"
      },
      "actions": [
        {
          "player": 1,
          "action": "check",
          "amount": 0
        },
        {
          "player": 3,
          "action": "bet",
          "amount": 55
        },
        {
          "player": 1,
          "action": "call",
          "amount": 55
        }
      ],
      "draws": []
    },
    {
      "name": "River",
      "cards": {
        "hero": "",
        "opponents": [
          "",
          "",
          "",
          "",
          ""
        ],
        "board": "3s"
      },
      "actions": [
        {
          "player": 1,
          "action": "check",
          "amount": 0
        },
        {
          "player": 3,
          "action": "check",
          "amount": 0
        }
      ],
      "draws": []
    }
  ],
  "result": {
    "winners": [
      {
        "playerIdx": 3,
        "split": false
      }
    ]
  }
};
