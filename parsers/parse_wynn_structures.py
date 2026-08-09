#!/usr/bin/env python3
"""
Parse Wynn Millions tournament structure PDF into JSON.
Reads pages 4-90, pairs structure pages with T&C pages, extracts all tournament data.
"""

import PyPDF2
import re
import json
import sys

def normalize_pdf_text(text):
    """Fix common PDF extraction artifacts like split numbers and extra spaces.

    PyPDF2 sometimes inserts spaces within numbers (e.g., "202 6" -> "2026",
    "1 6" -> "16", "1 2 p.m." -> "12 p.m.").
    """
    # Fix split month names: "Februa ry" -> "February", "Wednes day" -> "Wednesday"
    month_fixes = {
        r'Janu\s+ary': 'January', r'Febru\s*a\s*ry': 'February', r'Februa\s+ry': 'February',
        r'Ma\s+rch': 'March', r'Ap\s+ril': 'April',
        r'Ju\s+ne': 'June', r'Ju\s+ly': 'July',
        r'Au\s+gust': 'August', r'Septem\s+ber': 'September',
        r'Octo\s+ber': 'October', r'Novem\s+ber': 'November', r'Decem\s+ber': 'December',
    }
    for pattern, replacement in month_fixes.items():
        text = re.sub(pattern, replacement, text)

    # Fix split day names: "Wednes day" -> "Wednesday", etc.
    day_fixes = {
        r'Mon\s+day': 'Monday', r'Tues\s+day': 'Tuesday', r'Wednes\s*day': 'Wednesday',
        r'Wednesd\s*ay': 'Wednesday', r'Thurs\s+day': 'Thursday', r'Fri\s+day': 'Friday',
        r'Satur\s+day': 'Saturday', r'Sun\s+day': 'Sunday',
    }
    for pattern, replacement in day_fixes.items():
        text = re.sub(pattern, replacement, text)

    # Fix year: "202 6" -> "2026", "202 5" -> "2025"
    text = re.sub(r'202\s+(\d)', r'202\1', text)

    # Fix month days with split digits: "February 1 6" -> "February 16"
    # Match month name followed by a digit, space, digit
    text = re.sub(r'(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d)\s+(\d)',
                  r'\1 \2\3', text)

    # Fix double spaces after month names before day numbers
    text = re.sub(r'(January|February|March|April|May|June|July|August|September|October|November|December)\s{2,}(\d)',
                  r'\1 \2', text)

    # Fix weird date format: "February , 23 2026" -> "February 23, 2026"
    text = re.sub(r'(January|February|March|April|May|June|July|August|September|October|November|December)\s*,\s*(\d{1,2})\s+(\d{4})',
                  r'\1 \2, \3', text)

    # Fix time: "1 2 p.m." -> "12 p.m.", "at 1 2" -> "at 12"
    text = re.sub(r'at\s+(\d)\s+(\d)\s*(p\.?m\.?|a\.?m\.?)', r'at \1\2 \3', text)

    # Fix split dollar amounts: "$ 423" -> "$423", "$1 6" -> "$16"
    # Note: In replacement strings, $ is literal (no escaping needed)
    text = re.sub(r'\$\s+(\d)', r'$\1', text)
    # Fix "$1 6" -> "$16" but not "$1,600"
    text = re.sub(r'\$(\d)\s+(\d)(?=\s|[^,\d])', lambda m: f'${m.group(1)}{m.group(2)}', text)

    return text

def parse_number(s):
    """Parse a number string, removing commas and dollar signs."""
    if s is None:
        return None
    s = s.strip().replace(',', '').replace('$', '').replace('\u2013', '-').replace('\u2014', '-')
    try:
        return int(s)
    except ValueError:
        try:
            return float(s)
        except ValueError:
            return None

def classify_page(text):
    """Classify a page as 'structure', 'tc', or 'other'."""
    upper = text.upper()
    # Structure pages have blind level headers
    has_blind_header = ('SMALL BLIND' in upper and 'BIG BLIND' in upper)
    # Also check for TORSE/HORSE structure format
    has_mixed_header = ('BRING IN' in upper and 'COMPLETION' in upper and 'LIMITS' in upper)
    # Also check for 2-7 Mixed Limits format
    has_mixed_draw = ('NL SINGLE DRAW' in upper or 'PL DOUBLE DRAW' in upper)

    has_tc = 'TERMS AND CONDITIONS' in upper

    if has_blind_header or has_mixed_header or has_mixed_draw:
        return 'structure'
    elif has_tc:
        return 'tc'
    else:
        # Check if it's a continuation (e.g., page 30 bounty rules continuation)
        return 'other'

def parse_game_type(name):
    """Extract game type abbreviation from event name."""
    name_upper = name.upper()

    if 'HORSE' in name_upper and '2 DAY' in name_upper:
        return 'HORSE'
    if 'HORSE' in name_upper:
        return 'HORSE'
    if 'TORSE' in name_upper:
        return 'TORSE'
    if '2-7 MIXED LIMITS' in name_upper:
        return '2-7 Mixed Limits'
    if 'MIXED TRIPLE DRAW' in name_upper:
        return 'Mixed Triple Draw'
    if 'LIMIT 2-7 TRIPLE DRAW' in name_upper or 'LIMIT 2 -7 TRIPLE DRAW' in name_upper:
        return 'Limit 2-7 Triple Draw'
    if 'LIMIT OMAHA 8' in name_upper:
        return 'Limit O8'
    if 'BIG O' in name_upper:
        return 'Big O'
    if 'PLO' in name_upper:
        return 'PLO'
    if 'NLH' in name_upper or 'NO LIMIT HOLD' in name_upper:
        if 'TURBO' in name_upper:
            return 'NLH Turbo'
        if '6-MAX' in name_upper or '6 -MAX' in name_upper:
            return 'NLH 6-Max'
        if '8-MAX' in name_upper or '8 -MAX' in name_upper:
            return 'NLH 8-Max'
        return 'NLH'
    if 'MILESTONE SATELLITE' in name_upper:
        return 'NLH Satellite'
    # Wynn Millions Championship is NLH
    if 'WYNN MILLIONS' in name_upper or 'CHAMPIONSHIP' in name_upper:
        return 'NLH'

    return 'Mixed'

def parse_standard_levels(text):
    """Parse standard blind levels (Level, Small Blind, Big Blind, Ante)."""
    levels = []
    special_rows = []

    lines = text.split('\n')
    for line in lines:
        line = line.strip()
        if not line:
            continue

        # Check for special rows like "Dinner Break"
        if 'break' in line.lower() and ('dinner' in line.lower() or 'color' in line.lower()):
            special_rows.append(line.strip())
            continue

        # Try to match a level row: number followed by blind values
        # Standard format: "1  100  200  200"
        m = re.match(r'^(\d+)\s+([\d,]+)\s+([\d,]+)\s+([\d,]+)\s*$', line)
        if m:
            levels.append({
                "level": int(m.group(1)),
                "sb": parse_number(m.group(2)),
                "bb": parse_number(m.group(3)),
                "ante": parse_number(m.group(4))
            })
            continue

        # Try matching level with extra whitespace or trailing content
        m = re.match(r'^(\d+)\s+([\d,]+)\s+([\d,]+)\s+([\d,]+)', line)
        if m and not re.search(r'[a-zA-Z]', line[:line.find(m.group(4)) + len(m.group(4))]):
            levels.append({
                "level": int(m.group(1)),
                "sb": parse_number(m.group(2)),
                "bb": parse_number(m.group(3)),
                "ante": parse_number(m.group(4))
            })

    return levels, special_rows

def parse_limit_levels(text):
    """Parse limit game levels (Level, Small Blind, Big Blind, Limits)."""
    levels = []
    lines = text.split('\n')
    for line in lines:
        line = line.strip()
        if not line:
            continue

        # Format: "1  200  300  300-600"
        m = re.match(r'^(\d+)\s+([\d,]+)\s+([\d,]+)\s+([\d,]+)\s*-\s*([\d,]+)\s*$', line)
        if m:
            levels.append({
                "level": int(m.group(1)),
                "sb": parse_number(m.group(2)),
                "bb": parse_number(m.group(3)),
                "ante": 0,
                "limits": f"{m.group(4).strip()}-{m.group(5).strip()}"
            })

    return levels

def parse_horse_levels(text):
    """Parse HORSE/TORSE structure with Limit Games and Stud Games rows."""
    levels = []
    lines = text.split('\n')
    current_level = None
    current_limit_data = None
    current_stud_data = None

    for line in lines:
        line = line.strip()
        if not line:
            continue

        # Match level + Limit Games row: "1 Limit Games   200 300 300-600"
        m = re.match(r'^(\d+)\s+Limit\s+Games\s+([\d,]+)\s+([\d,]+)\s+([\d,]+)\s*-\s*([\d,]+)', line)
        if m:
            current_level = int(m.group(1))
            current_limit_data = {
                "sb": parse_number(m.group(2)),
                "bb": parse_number(m.group(3)),
                "limits": f"{m.group(4).strip()}-{m.group(5).strip()}"
            }
            continue

        # Match Limit Games row without level number (continuation)
        m = re.match(r'^Limit\s+Games\s+([\d,]+)\s+([\d,]+)\s+([\d,]+)\s*-\s*([\d,]+)', line)
        if m:
            current_limit_data = {
                "sb": parse_number(m.group(1)),
                "bb": parse_number(m.group(2)),
                "limits": f"{m.group(3).strip()}-{m.group(4).strip()}"
            }
            continue

        # Match Stud Games row: "Stud Games  100 100 300 300-600"
        m = re.match(r'^Stud\s+Games\s+([\d,]+)\s+([\d,]+)\s+([\d,]+)\s+([\d,]+)\s*-\s*([\d,]+)', line)
        if m:
            current_stud_data = {
                "ante": parse_number(m.group(1)),
                "bring_in": parse_number(m.group(2)),
                "bb": parse_number(m.group(3)),
                "limits": f"{m.group(4).strip()}-{m.group(5).strip()}"
            }
            # We have both limit and stud data for this level, create the level entry
            if current_level is not None and current_limit_data is not None:
                levels.append({
                    "level": current_level,
                    "limit_games": {
                        "sb": current_limit_data["sb"],
                        "bb": current_limit_data["bb"],
                        "limits": current_limit_data["limits"]
                    },
                    "stud_games": {
                        "ante": current_stud_data["ante"],
                        "bring_in": current_stud_data["bring_in"],
                        "bb": current_stud_data["bb"],
                        "limits": current_stud_data["limits"]
                    }
                })
            continue

    return levels

def parse_mixed_draw_levels(text):
    """Parse 2-7 Mixed Limits structure (NL Single Draw, PL Double Draw, Limit Triple Draw).

    The level number appears on the PL Double Draw row (middle game).
    Each level has 3 game rows: NL Single Draw, PL Double Draw, Limit Triple Draw.
    The NL Single Draw row for the NEXT level appears before the level number row.
    """
    levels = []
    lines = text.split('\n')
    pending_games = {}  # Games for the upcoming level (before we know its number)
    current_level = None
    current_games = {}

    def _parse_game_line(line):
        """Try to parse a game line, return (level_num_or_none, game_type, game_data) or None."""
        # With level number: "1 PL Double Draw  100   100   100"
        m = re.match(r'^(\d+)\s+(NL Single Draw|PL Double Draw|Limit Triple Draw)\s+([\d,]+)\s+([\d,]+)\s+([\d,]+)', line)
        if m:
            return (int(m.group(1)), m.group(2), {
                "sb": parse_number(m.group(3)),
                "bb": parse_number(m.group(4)),
                "ante": parse_number(m.group(5))
            })

        # Without level number, 3 values: "NL Single Draw  200  300  500"
        m = re.match(r'^(NL Single Draw|PL Double Draw|Limit Triple Draw)\s+([\d,]+)\s+([\d,]+)\s+([\d,]+)', line)
        if m:
            return (None, m.group(1), {
                "sb": parse_number(m.group(2)),
                "bb": parse_number(m.group(3)),
                "ante": parse_number(m.group(4))
            })

        # Without level number, 2 values (Limit Triple Draw no ante): "Limit Triple Draw  200  300"
        m = re.match(r'^(NL Single Draw|PL Double Draw|Limit Triple Draw)\s+([\d,]+)\s+([\d,]+)\s*$', line)
        if m:
            return (None, m.group(1), {
                "sb": parse_number(m.group(2)),
                "bb": parse_number(m.group(3)),
                "ante": 0
            })

        return None

    for line in lines:
        line = line.strip()
        if not line:
            continue

        parsed = _parse_game_line(line)
        if not parsed:
            continue

        level_num, game_type, game_data = parsed

        if level_num is not None:
            # This line has a level number (typically PL Double Draw)
            if current_level is not None and current_games:
                # Finalize the previous level
                levels.append({
                    "level": current_level,
                    "games": dict(current_games)
                })

            # Start new level with any pending games
            current_level = level_num
            current_games = dict(pending_games)
            pending_games = {}
            current_games[game_type] = game_data
        else:
            # No level number
            if game_type in current_games and current_level is not None:
                # This game type already exists in current level -- it's for the next level
                # Finalize current level first
                levels.append({
                    "level": current_level,
                    "games": dict(current_games)
                })
                current_games = {}
                current_level = None
                pending_games = {game_type: game_data}
            elif current_level is None:
                # No level assigned yet, add to pending
                pending_games[game_type] = game_data
            else:
                # Add to current level
                current_games[game_type] = game_data

    # Don't forget the last level
    if current_level is not None and current_games:
        levels.append({
            "level": current_level,
            "games": dict(current_games)
        })

    return levels

def parse_structure_page(text):
    """Parse a structure page to extract event name, entry fee, guarantee, and levels."""
    result = {}
    lines = [l.strip() for l in text.split('\n') if l.strip()]

    # Collect all header lines before the level table begins
    # The level table starts with the header row containing "Level" + "Small Blind"
    # or "LEVEL" + "TYPE" for mixed games
    header_lines = []
    for line in lines:
        # Stop at the level table header row
        if ('Small Blind' in line and 'Big Blind' in line) or \
           ('SMALL BLIND' in line and 'BIG BLIND' in line) or \
           ('BRING IN' in line and 'COMPLETION' in line):
            break
        # Also stop at a numbered level row (e.g., "1  100  200  200")
        if re.match(r'^\d+\s+(?:NL Single Draw|PL Double Draw|Limit Triple Draw|Limit Games|Stud Games|\d)', line):
            break
        # Stop at "Level" header if it's the start of the table
        if line.strip() == 'Level' or (line.strip().startswith('Level') and 'Small Blind' in line):
            break
        if 'LEVEL' in line and 'TYPE' in line:
            break
        header_lines.append(line.strip())

    # Parse event name, entry fee, and guarantee from header lines
    event_name = ""
    entry_fee = None
    guarantee = None

    for part in header_lines:
        # Check for entry fee: "$500 Entry Fee" or "$10,500 Entry Fee"
        fee_m = re.search(r'\$\s*([\d,]+)\s*Entry\s*Fee', part)
        if fee_m:
            entry_fee = parse_number(fee_m.group(1))
            continue

        # Check for guarantee: "$50,000 Guarantee" or "$1,000,000 Guarantee"
        guar_m = re.search(r'\$\s*([\d,]+)\s*Guarantee', part)
        if guar_m:
            guarantee = parse_number(guar_m.group(1))
            continue

        # Otherwise it's part of the event name
        if part:
            if event_name:
                event_name += " " + part
            else:
                event_name = part

    # Clean up event name - remove special characters
    event_name = event_name.replace('\u2013', '-').replace('\u2014', '-')
    event_name = re.sub(r'[^\x20-\x7E]', "'", event_name)  # Replace non-ASCII with apostrophe
    # Collapse multiple spaces and fix "8 -Max" -> "8-Max", "$500 " etc.
    event_name = re.sub(r'\s+', ' ', event_name)
    event_name = re.sub(r'(\d)\s+-\s*', r'\1-', event_name)  # "8 -Max" -> "8-Max"
    event_name = re.sub(r'\s*-\s+(\w)', r'-\1', event_name)  # "2 -7" -> "2-7"
    event_name = re.sub(r'\$\s+', '$', event_name)  # "$ 500" -> "$500"
    event_name = event_name.strip()

    result['event_name'] = event_name
    result['entry_fee'] = entry_fee
    result['guarantee'] = guarantee

    # Determine level format and parse
    upper = text.upper()

    if 'BRING IN' in upper and 'COMPLETION' in upper:
        # HORSE/TORSE format
        result['levels'] = parse_horse_levels(text)
        result['level_format'] = 'horse'
    elif 'NL SINGLE DRAW' in upper or 'PL DOUBLE DRAW' in upper:
        # 2-7 Mixed Limits format
        result['levels'] = parse_mixed_draw_levels(text)
        result['level_format'] = 'mixed_draw'
    elif 'LIMITS' in upper and re.search(r'\d+-\d', text):
        # Check if it's a limit game format (has Limits column with ranges like "300-600")
        limit_levels = parse_limit_levels(text)
        if limit_levels:
            result['levels'] = limit_levels
            result['level_format'] = 'limit'
        else:
            levels, special = parse_standard_levels(text)
            result['levels'] = levels
            result['special_rows'] = special
            result['level_format'] = 'standard'
    else:
        levels, special = parse_standard_levels(text)
        result['levels'] = levels
        result['special_rows'] = special if special else []
        result['level_format'] = 'standard'

    return result

def parse_tc_page(text):
    """Parse a Terms & Conditions page to extract detailed event info."""
    result = {}

    # Clean text
    text = text.replace('\u2013', '-').replace('\u2014', '-')
    text = text.replace('\u201c', '"').replace('\u201d', '"')
    text = text.replace('\u2018', "'").replace('\u2019', "'")

    # Extract dates
    dates = []
    # Match bullet-point dates: "Monday, February 16, 2026 at 12 p.m."
    # Also match "Day 1A: Friday, February 20, 2026 at 12 p.m."
    date_pattern = r'(?:Day\s*\d+[A-Z]?\s*(?:\([^)]*\))?\s*:\s*)?(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\s*,?\s*(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}\s*,?\s*\d{4}\s+at\s+\d{1,2}(?::\d{2})?\s*[ap]\.?m\.?'
    for m in re.finditer(date_pattern, text, re.IGNORECASE):
        date_str = m.group(0).strip()
        # Clean up the date string
        date_str = re.sub(r'\s+', ' ', date_str)
        dates.append(date_str)

    # If no dates found with "at time", try broader pattern
    if not dates:
        date_pattern2 = r'(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\s*,?\s*(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}\s*,?\s*\d{4}'
        for m in re.finditer(date_pattern2, text, re.IGNORECASE):
            dates.append(m.group(0).strip())

    result['dates'] = dates

    # Extract entry fee breakdown
    # Standard: "$500 Buy-in = $423 (Tournament Prize Pool) + $55 (Tournament Fee) + $22 (Poker Staff Service Charge)"
    # Bounty: "$1,600 Buy-in = $940 (Tournament Prize Pool) + $500 (Bounty Prize Pool) + $115 (Tournament Fee) + $45 (Poker Staff Service Charge)"

    fee_text = text.replace('\n', ' ')

    prize_pool = None
    bounty_pool = None
    tournament_fee = None
    staff_charge = None

    # Prize Pool
    m = re.search(r'\$\s*([\d,]+)\s*\(Tournament\s+Prize\s+Pool\)', fee_text)
    if m:
        prize_pool = parse_number(m.group(1))

    # Bounty Prize Pool
    m = re.search(r'\$\s*([\d,]+)\s*\(Bounty\s+Prize\s+Pool\)', fee_text)
    if m:
        bounty_pool = parse_number(m.group(1))

    # Tournament Fee
    m = re.search(r'\$\s*([\d,]+)\s*\(Tournament\s+Fee\)', fee_text)
    if m:
        tournament_fee = parse_number(m.group(1))

    # Staff Service Charge
    m = re.search(r'\$\s*([\d,]+)\s*\((?:Poker\s+)?Staff\s+Service\s+Charge\)', fee_text)
    if m:
        staff_charge = parse_number(m.group(1))

    result['prize_pool_portion'] = prize_pool
    result['bounty_pool'] = bounty_pool
    result['tournament_fee'] = tournament_fee
    result['staff_service_charge'] = staff_charge

    # Starting stack
    m = re.search(r'(?:start\s+with|starting\s+stack[:\s]+)\s*([\d,]+)\s*(?:in\s+)?tournament\s+chips', fee_text, re.IGNORECASE)
    if m:
        result['starting_stack'] = parse_number(m.group(1))
    else:
        result['starting_stack'] = None

    # Level duration - can be complex for multi-day events
    # Simple: "30 minutes per level"
    # Complex: "Day 1 A-1E: 30 minutes per level...\nDay 2: 40 minutes per level..."
    # Also: "Levels 1-6: 30 minutes per level.\nLevels 7 and above: 40 minutes per level"

    # Find all "X minutes per level" with their preceding context
    # Use a more structured regex that captures "Day/Level prefix: X minutes per level"
    duration_pattern = r'((?:Day\s+\d+[A-Z]?\s*(?:[A-Z&,-]\s*\d*[A-Z]?)*|Levels?\s+\d+\s*(?:-\s*\d+)?(?:\s+and\s+above)?|Final\s+Table)\s*:\s*)?(\d+)\s*minutes\s+per\s+level'
    level_durations = []
    seen_labels = set()
    for m in re.finditer(duration_pattern, fee_text, re.IGNORECASE):
        label = m.group(1).strip().rstrip(':').strip() if m.group(1) else None
        dur = int(m.group(2))
        # Deduplicate by label
        dedup_key = (label or '', dur)
        if dedup_key not in seen_labels:
            seen_labels.add(dedup_key)
            level_durations.append((dur, label))

    # Also check for "X minutes per level thereafter" pattern (heads-up)
    m = re.search(r'(\d+)\s*minutes\s+per\s+level\s+thereafter', fee_text, re.IGNORECASE)
    if m:
        dur = int(m.group(1))
        dedup_key = ('Heads-up', dur)
        if dedup_key not in seen_labels:
            seen_labels.add(dedup_key)
            level_durations.append((dur, 'Heads-up'))

    if len(level_durations) == 1:
        result['level_duration_minutes'] = level_durations[0][0]
    elif len(level_durations) > 1:
        # Use the first (usually Day 1 or main duration)
        result['level_duration_minutes'] = level_durations[0][0]
        result['level_duration_details'] = []
        for dur, label in level_durations:
            if label:
                result['level_duration_details'].append(f"{label}: {dur} minutes")
            else:
                result['level_duration_details'].append(f"{dur} minutes")
    else:
        # Try "Ten (10) levels of 60 minutes each" pattern
        m = re.search(r'\(?\d+\)?\s*levels?\s+of\s+(\d+)\s*minutes\s+each', fee_text, re.IGNORECASE)
        if m:
            result['level_duration_minutes'] = int(m.group(1))
        else:
            result['level_duration_minutes'] = None

    # Break schedule
    break_patterns = [
        r'(\d+)\s*-?\s*minute\s+break\s+every\s+(\d+)\s+levels?\s+of\s+play',
        r'(\d+)\s*-?\s*minute\s+break\s+every\s+(\d+)\s+levels',
    ]
    for pat in break_patterns:
        m = re.search(pat, fee_text, re.IGNORECASE)
        if m:
            result['break_schedule'] = f"{m.group(1)}-minute break every {m.group(2)} levels"
            break
    else:
        result['break_schedule'] = None

    # Players per table
    m = re.search(r'(?:Tables?\s+will\s+play|play)\s+(\d+)\s*-?\s*handed', fee_text, re.IGNORECASE)
    if m:
        result['players_per_table'] = int(m.group(1))
    else:
        result['players_per_table'] = None

    # Final table seats
    m = re.search(r'Final\s+Table\s+will\s+begin\s+(\d+)\s*-?\s*handed', fee_text, re.IGNORECASE)
    if m:
        result['final_table_seats'] = int(m.group(1))
    else:
        result['final_table_seats'] = None

    # Re-entry until level
    m = re.search(r're\s*-?\s*entry\s+.*?(?:until|available\s+until)\s+(?:the\s+)?(?:start|beginning)\s+of\s+level\s+(\d+)', fee_text, re.IGNORECASE)
    if m:
        result['re_entry_until_level'] = int(m.group(1))
    else:
        result['re_entry_until_level'] = None

    # Add-on info
    addon_m = re.search(r'(?:One\s*\(\s*1\s*\)\s*)?\$\s*([\d,]+)\s+add\s*-?\s*on\s+for\s+([\d,]+)\s+tournament\s+chips', fee_text, re.IGNORECASE)
    if addon_m:
        result['add_on'] = {
            "cost": parse_number(addon_m.group(1)),
            "chips": parse_number(addon_m.group(2))
        }
    else:
        result['add_on'] = None

    return result

def merge_tournament(structure_data, tc_data):
    """Merge structure page data with T&C page data into final tournament object."""
    entry_fee = structure_data.get('entry_fee') or 0
    tournament_fee = tc_data.get('tournament_fee') or 0
    staff_charge = tc_data.get('staff_service_charge') or 0
    rake_total = tournament_fee + staff_charge
    rake_pct = round((rake_total / entry_fee) * 100, 1) if entry_fee > 0 else 0

    tournament = {
        "event_name": structure_data.get('event_name', ''),
        "entry_fee": entry_fee,
        "guarantee": structure_data.get('guarantee'),
        "prize_pool_portion": tc_data.get('prize_pool_portion'),
        "bounty_pool": tc_data.get('bounty_pool'),
        "tournament_fee": tournament_fee,
        "staff_service_charge": staff_charge,
        "rake_total": rake_total,
        "rake_pct": rake_pct,
        "dates": tc_data.get('dates', []),
        "starting_stack": tc_data.get('starting_stack'),
        "level_duration_minutes": tc_data.get('level_duration_minutes'),
        "break_schedule": tc_data.get('break_schedule'),
        "players_per_table": tc_data.get('players_per_table'),
        "final_table_seats": tc_data.get('final_table_seats'),
        "re_entry_until_level": tc_data.get('re_entry_until_level'),
        "add_on": tc_data.get('add_on'),
        "game_type": parse_game_type(structure_data.get('event_name', '')),
        "level_format": structure_data.get('level_format', 'standard'),
        "levels": structure_data.get('levels', []),
    }

    # Add special rows if present (like Dinner Break)
    if structure_data.get('special_rows'):
        tournament['special_rows'] = structure_data['special_rows']

    # Add level duration details if present
    if tc_data.get('level_duration_details'):
        tournament['level_duration_details'] = tc_data['level_duration_details']

    # Remove bounty_pool if None
    if tournament['bounty_pool'] is None:
        del tournament['bounty_pool']

    return tournament

def main():
    pdf_path = 'D:/_snbwsop/Wynn_Millions_Structures.pdf'
    reader = PyPDF2.PdfReader(pdf_path)
    total_pages = len(reader.pages)
    print(f"Total PDF pages: {total_pages}")

    # Read and classify all pages 4-90 (0-indexed: 3-89)
    pages = []
    for i in range(3, min(90, total_pages)):
        text = reader.pages[i].extract_text()
        text = normalize_pdf_text(text)
        page_type = classify_page(text)
        pages.append({
            'page_num': i + 1,
            'type': page_type,
            'text': text
        })

    print(f"\nPage classification summary:")
    type_counts = {}
    for p in pages:
        type_counts[p['type']] = type_counts.get(p['type'], 0) + 1
    for t, c in sorted(type_counts.items()):
        print(f"  {t}: {c} pages")

    # Now pair structure pages with their T&C pages
    tournaments = []
    i = 0
    while i < len(pages):
        page = pages[i]

        if page['type'] == 'structure':
            # Parse the structure page
            structure_data = parse_structure_page(page['text'])

            # Look for the following T&C page
            tc_text = ""
            j = i + 1
            while j < len(pages):
                if pages[j]['type'] == 'tc':
                    tc_text = pages[j]['text']
                    # Check if next page is a continuation (type 'other')
                    k = j + 1
                    while k < len(pages) and pages[k]['type'] == 'other':
                        tc_text += "\n" + pages[k]['text']
                        k += 1
                    j = k  # j points to next unprocessed page
                    break
                elif pages[j]['type'] == 'structure':
                    # No T&C page found, structure page has no T&C
                    break
                else:
                    j += 1

            if tc_text:
                tc_data = parse_tc_page(tc_text)
                tournament = merge_tournament(structure_data, tc_data)
                tournaments.append(tournament)
                i = j if j > i + 1 else i + 2
            else:
                # Structure page without T&C - skip or create partial
                print(f"  WARNING: Structure page {page['page_num']} has no matching T&C page")
                i += 1
        elif page['type'] == 'tc' or page['type'] == 'other':
            # T&C page without preceding structure page - check if it IS a structure page
            # (TORSE/HORSE have structure embedded in their "T&C-continuation" page)
            # Actually these are already classified as 'structure' due to the header detection
            # This handles orphaned T&C pages

            # Check if this is actually a structure+TC combo (like satellite T&C-only pages)
            # For pages classified as T&C without a preceding structure page, check if
            # this is a standalone T&C (like the bounty continuation on page 30)
            i += 1
        else:
            i += 1

    # Output
    output_path = 'D:/_snbwsop/parsers/wynn-millions-structures.json'
    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(tournaments, f, indent=2, ensure_ascii=False)

    print(f"\n{'='*60}")
    print(f"Successfully parsed {len(tournaments)} tournaments")
    print(f"Output saved to: {output_path}")
    print(f"{'='*60}")

    # Print summary of first 3
    print(f"\n--- First 3 tournaments ---")
    for i, t in enumerate(tournaments[:3]):
        print(f"\n[{i+1}] {t['event_name']}")
        print(f"    Entry Fee: ${t['entry_fee']}")
        print(f"    Guarantee: ${t.get('guarantee', 'N/A')}")
        print(f"    Game Type: {t['game_type']}")
        print(f"    Rake: ${t['rake_total']} ({t['rake_pct']}%)")
        print(f"    Dates: {len(t['dates'])} offered")
        for d in t['dates'][:3]:
            print(f"      - {d}")
        print(f"    Starting Stack: {t['starting_stack']}")
        print(f"    Level Duration: {t['level_duration_minutes']} min")
        print(f"    Levels: {len(t['levels'])}")
        if t['levels']:
            lv = t['levels'][0]
            if 'sb' in lv:
                print(f"      Level 1: SB={lv['sb']} BB={lv['bb']} Ante={lv.get('ante', 0)}")
            elif 'limit_games' in lv:
                print(f"      Level 1 (Limit): SB={lv['limit_games']['sb']} BB={lv['limit_games']['bb']}")
            elif 'games' in lv:
                print(f"      Level 1 (Mixed): {list(lv['games'].keys())}")

    # Print summary of all
    print(f"\n--- All tournaments summary ---")
    for i, t in enumerate(tournaments):
        g = f"${t['guarantee']:,}" if t.get('guarantee') else "N/A"
        print(f"  {i+1:2d}. ${t['entry_fee']:>6,} | {t['game_type']:<25s} | GTD: {g:<15s} | {t['event_name'][:50]}")

if __name__ == '__main__':
    main()
