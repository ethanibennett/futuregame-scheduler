import json

with open('D:/_snbwsop/parsers/wynn-millions-structures.json', 'r') as f:
    tournaments = json.load(f)

print(f"Total tournaments: {len(tournaments)}")

# Detailed check of several events
print("\n--- Detailed Event Checks ---\n")

# Check NLH Turbo $300 has add-on
t = tournaments[1]
print(f"[2] {t['event_name']} (${t['entry_fee']})")
print(f"    Staff charge: ${t['staff_service_charge']}")
print(f"    Add-on: {t['add_on']}")
print(f"    Rake: ${t['rake_total']} ({t['rake_pct']}%)")

# Check bounty events have bounty_pool
for i, t in enumerate(tournaments):
    if 'bounty_pool' in t:
        print(f"\n[{i+1}] {t['event_name']} (${t['entry_fee']})")
        print(f"    Bounty pool: ${t['bounty_pool']}")
        print(f"    Prize pool: ${t['prize_pool_portion']}")
        print(f"    Tournament fee: ${t['tournament_fee']}")
        print(f"    Staff charge: ${t['staff_service_charge']}")
        actual_total = t['prize_pool_portion'] + t['bounty_pool'] + t['tournament_fee'] + t['staff_service_charge']
        print(f"    Sum: ${actual_total} (entry fee: ${t['entry_fee']})")
        if actual_total != t['entry_fee']:
            print(f"    *** MISMATCH! Entry fee doesn't match sum of components")

# Check multi-day events have level_duration_details
for i, t in enumerate(tournaments):
    if t.get('level_duration_details'):
        print(f"\n[{i+1}] {t['event_name']} (${t['entry_fee']})")
        print(f"    Level duration: {t['level_duration_minutes']} min")
        for detail in t['level_duration_details']:
            print(f"      {detail}")

# Check special rows
for i, t in enumerate(tournaments):
    if t.get('special_rows'):
        print(f"\n[{i+1}] {t['event_name']} - special rows:")
        for row in t['special_rows']:
            print(f"      {row}")

# Check HORSE/TORSE level structure
for i, t in enumerate(tournaments):
    if t['level_format'] == 'horse':
        print(f"\n[{i+1}] {t['event_name']} ({t['level_format']} format, {len(t['levels'])} levels)")
        lv = t['levels'][0]
        print(f"    Level 1 Limit: SB={lv['limit_games']['sb']} BB={lv['limit_games']['bb']} Limits={lv['limit_games']['limits']}")
        print(f"    Level 1 Stud:  Ante={lv['stud_games']['ante']} BringIn={lv['stud_games']['bring_in']} BB={lv['stud_games']['bb']}")

# Check 2-7 Mixed Limits
for i, t in enumerate(tournaments):
    if t['level_format'] == 'mixed_draw':
        print(f"\n[{i+1}] {t['event_name']} ({t['level_format']} format, {len(t['levels'])} levels)")
        lv = t['levels'][0]
        print(f"    Level 1 games: {list(lv['games'].keys())}")
        for game, data in lv['games'].items():
            print(f"      {game}: SB={data['sb']} BB={data['bb']} Ante={data['ante']}")

# Verify entry fee = prize_pool + tournament_fee + staff_charge for non-bounty events
print("\n--- Entry Fee Component Verification ---")
mismatches = []
for i, t in enumerate(tournaments):
    if t['prize_pool_portion'] is not None and t['tournament_fee'] is not None and t['staff_service_charge'] is not None:
        bounty = t.get('bounty_pool', 0) or 0
        expected = t['prize_pool_portion'] + bounty + t['tournament_fee'] + t['staff_service_charge']
        if expected != t['entry_fee']:
            mismatches.append((i+1, t['event_name'], t['entry_fee'], expected))

if mismatches:
    for idx, name, fee, expected in mismatches:
        print(f"  [{idx}] {name}: entry_fee=${fee}, components sum=${expected}")
else:
    print("  All entry fees match their component sums!")

# Count level formats
formats = {}
for t in tournaments:
    fmt = t['level_format']
    formats[fmt] = formats.get(fmt, 0) + 1
print(f"\nLevel format distribution: {formats}")
