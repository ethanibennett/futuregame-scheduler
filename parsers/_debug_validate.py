import json

with open('D:/_snbwsop/parsers/wynn-millions-structures.json', 'r') as f:
    tournaments = json.load(f)

print(f"Total tournaments: {len(tournaments)}\n")

# Check specific known values
checks = []

# Check tournament 1: $500 NLH
t = tournaments[0]
checks.append(("T1 entry_fee", t['entry_fee'], 500))
checks.append(("T1 guarantee", t['guarantee'], 50000))
checks.append(("T1 prize_pool", t['prize_pool_portion'], 423))
checks.append(("T1 tournament_fee", t['tournament_fee'], 55))
checks.append(("T1 staff_charge", t['staff_service_charge'], 22))
checks.append(("T1 rake_total", t['rake_total'], 77))
checks.append(("T1 dates_count", len(t['dates']), 3))
checks.append(("T1 starting_stack", t['starting_stack'], 30000))
checks.append(("T1 level_duration", t['level_duration_minutes'], 30))
checks.append(("T1 players_per_table", t['players_per_table'], 9))
checks.append(("T1 final_table", t['final_table_seats'], 9))
checks.append(("T1 re_entry_level", t['re_entry_until_level'], 9))
checks.append(("T1 num_levels", len(t['levels']), 28))
checks.append(("T1 level1_sb", t['levels'][0]['sb'], 100))
checks.append(("T1 level28_bb", t['levels'][27]['bb'], 200000))

# Check tournament 2: $300 NLH Turbo (with add-on)
t = tournaments[1]
checks.append(("T2 entry_fee", t['entry_fee'], 300))
checks.append(("T2 prize_pool", t['prize_pool_portion'], 250))
checks.append(("T2 tournament_fee", t['tournament_fee'], 34))
checks.append(("T2 staff_charge", t['staff_service_charge'], 16))
checks.append(("T2 add_on", t['add_on'] is not None, True))
if t['add_on']:
    checks.append(("T2 add_on_cost", t['add_on']['cost'], 100))
    checks.append(("T2 add_on_chips", t['add_on']['chips'], 25000))

# Check Wynn Millions Championship (tournament 17)
t = tournaments[16]
checks.append(("T17 name", t['event_name'], "Wynn Millions Championship"))
checks.append(("T17 entry_fee", t['entry_fee'], 3500))
checks.append(("T17 guarantee", t['guarantee'], 2000000))
checks.append(("T17 prize_pool", t['prize_pool_portion'], 3175))
checks.append(("T17 tournament_fee", t['tournament_fee'], 215))
checks.append(("T17 staff_charge", t['staff_service_charge'], 110))
checks.append(("T17 starting_stack", t['starting_stack'], 50000))
checks.append(("T17 re_entry_level", t['re_entry_until_level'], 7))
checks.append(("T17 has_special_rows", 'special_rows' in t, True))
checks.append(("T17 num_levels", len(t['levels']), 29))

# Check bounty event (tournament 13: $10,500 NLH PKO)
t = tournaments[12]
checks.append(("T13 entry_fee", t['entry_fee'], 10500))
checks.append(("T13 prize_pool", t['prize_pool_portion'], 6000))
checks.append(("T13 has_bounty", 'bounty_pool' in t, True))
if 'bounty_pool' in t:
    checks.append(("T13 bounty_pool", t['bounty_pool'], 4000))
checks.append(("T13 tournament_fee", t['tournament_fee'], 420))
checks.append(("T13 staff_charge", t['staff_service_charge'], 80))

# Check PLO bounty (tournament 16)
t = tournaments[15]
checks.append(("T16 entry_fee", t['entry_fee'], 1600))
checks.append(("T16 has_bounty", 'bounty_pool' in t, True))
if 'bounty_pool' in t:
    checks.append(("T16 bounty_pool", t['bounty_pool'], 500))

# Check HORSE/TORSE (tournaments 7,8)
t = tournaments[6]
checks.append(("T7_TORSE level_format", t['level_format'], "horse"))
checks.append(("T7_TORSE num_levels", len(t['levels']), 20))

t = tournaments[7]
checks.append(("T8_HORSE level_format", t['level_format'], "horse"))
checks.append(("T8_HORSE players_per_table", t['players_per_table'], 8))

# Check 2-7 Mixed Limits (tournament 21)
t = tournaments[20]
checks.append(("T21 entry_fee", t['entry_fee'], 600))
checks.append(("T21 level_format", t['level_format'], "mixed_draw"))
checks.append(("T21 num_levels", len(t['levels']), 15))

# Check Limit Omaha 8 (tournament 10)
t = tournaments[9]
checks.append(("T10 level_format", t['level_format'], "limit"))

# Run all checks
passed = 0
failed = 0
for name, actual, expected in checks:
    if actual == expected:
        passed += 1
    else:
        failed += 1
        print(f"  FAIL: {name}: expected {expected}, got {actual}")

print(f"\n{passed}/{passed+failed} checks passed, {failed} failed")

# Check for any tournaments with 0 entry fee (shouldn't happen)
zero_fees = [i for i, t in enumerate(tournaments) if t['entry_fee'] == 0]
if zero_fees:
    print(f"\nWARNING: Tournaments with $0 entry fee: {zero_fees}")

# Check for any tournaments with 0 levels
zero_levels = [i for i, t in enumerate(tournaments) if len(t['levels']) == 0]
if zero_levels:
    print(f"\nWARNING: Tournaments with 0 levels: {zero_levels}")

# Check for any tournaments with missing dates
no_dates = [i for i, t in enumerate(tournaments) if len(t['dates']) == 0]
if no_dates:
    print(f"\nWARNING: Tournaments with no dates: indices {no_dates}")
    for idx in no_dates:
        print(f"  [{idx}] {tournaments[idx]['event_name']}")

# Check game types
print("\nGame type distribution:")
types = {}
for t in tournaments:
    gt = t['game_type']
    types[gt] = types.get(gt, 0) + 1
for gt, count in sorted(types.items()):
    print(f"  {gt}: {count}")
