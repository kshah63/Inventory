"""Proposed catalogue renaming: ITEM - TYPE - COLOUR - SIZE - BRAND.

Each row: sku, new name, new unit (None = unchanged), new pack size
(None = unchanged), flag. Flags: 'spelling', 'wording', 'check' (needs a
human decision), '' (mechanical).
"""

MAP = [
    # ── Cleaning ────────────────────────────────────────────────────────
    ("CLN-001", "MASK",                          "box",    50,  ""),
    ("CLN-002", "TISSUE",                        None,   None,  ""),
    ("CLN-003", "HAND SANITISER",                None,   None,  "spelling"),
    ("CLN-004", "CLEANING SPRAY - TABLE",        None,   None,  ""),
    ("CLN-005", "TOILET CLEANER - HARPIC",       None,   None,  "wording"),
    ("CLN-006", "ANTISEPTIC LIQUID - DETTOL",    None,   None,  "check"),
    ("CLN-007", "AIR FRESHENER - GLADE",         None,   None,  "spelling"),
    ("CLN-008", "FLOOR CLEANER - DETTOL",        None,   None,  ""),
    ("CLN-009", "DISINFECTANT - DETTOL",         None,   None,  ""),

    # ── Pantry ──────────────────────────────────────────────────────────
    ("PAN-001", "CUP - PLASTIC",                 "packet", 50,  "wording"),

    # ── Printing & Paper ────────────────────────────────────────────────
    ("PPR-001", "PAPER - A4",                    None,   None,  ""),
    ("PPR-002", "PAPER - A3",                    None,   None,  ""),
    ("PPR-003", "LAMINATION POUCH - A3",         "box",   100,  ""),
    ("PPR-004", "LAMINATION POUCH - A4",         "box",   100,  ""),
    ("PPR-005", "LAMINATION POUCH - A5",         "box",   100,  ""),
    ("PPR-006", "LAMINATION POUCH - A8",         "box",   100,  ""),
    ("PPR-007", "CARDBOARD - BLACK",             None,   None,  ""),
    ("PPR-008", "COVER - CLEAR",                 None,   None,  ""),
    ("PPR-009", "SHEET PROTECTOR - A4",          "packet", 100, ""),
    ("PPR-010", "DIVIDER - PAPER",               None,   None,  ""),
    ("PPR-011", "WRITING PAD - A4",              None,   None,  ""),
    ("PPR-012", "CARD CASE - HARD - A4",         None,   None,  ""),
    ("PPR-013", "SHEET - CLEAR - A3",            None,   None,  ""),

    # ── Pens ────────────────────────────────────────────────────────────
    ("STA-001", "PEN - RED - 0.7MM",             None,   None,  ""),
    ("STA-002", "PEN - BLUE - 0.7MM",            None,   None,  ""),
    ("STA-003", "PEN - BLACK - 0.7MM",           None,   None,  ""),
    ("STA-004", "PEN - GREEN - 0.7MM",           None,   None,  ""),
    ("STA-030", "PEN - BALLPOINT - PURPLE - REDLEAF", None, None, "check"),
    ("STA-031", "PEN - RED - GSOFT",             None,   None,  ""),
    ("STA-032", "PEN - GEL - UBIBALL",           None,   None,  "check"),

    # ── Pen refills ─────────────────────────────────────────────────────
    ("STA-028", "PEN REFILL - BLACK - 0.5MM",    None,   None,  ""),
    ("STA-023", "PEN REFILL - BLACK - 0.7MM",    None,   None,  ""),
    ("STA-025", "PEN REFILL - BLUE - 0.5MM",     None,   None,  ""),
    ("STA-024", "PEN REFILL - BLUE - 0.7MM",     None,   None,  ""),
    ("STA-027", "PEN REFILL - GREEN - 0.5MM",    None,   None,  ""),
    ("STA-021", "PEN REFILL - GREEN - 0.7MM",    None,   None,  ""),
    ("STA-026", "PEN REFILL - PURPLE - 0.5MM",   None,   None,  ""),
    ("STA-022", "PEN REFILL - PURPLE - 0.7MM",   None,   None,  "spelling"),
    ("STA-038", "MARKER REFILL - WHITEBOARD - MIXED", None, None, ""),

    # ── Pencils & leads ─────────────────────────────────────────────────
    ("STA-005", "PENCIL - BLUE",                 "box",   10,   ""),
    ("STA-075", "PENCIL - RED - STABILO SCHWAN", "box",   12,   ""),
    ("STA-017", "PENCIL - MECHANICAL - 0.5MM",   None,   None,  ""),
    ("STA-064", "PENCIL - MECHANICAL - 0.7MM",   None,   None,  ""),
    ("STA-018", "PENCIL LEAD - 2B - 0.5MM - PILOT", None, None, ""),
    ("STA-019", "PENCIL LEAD - 2B - 0.7MM - STEIN", None, None, ""),

    # ── Highlighters ────────────────────────────────────────────────────
    ("STA-067", "HIGHLIGHTER - BLUE",            None,   None,  ""),
    ("STA-068", "HIGHLIGHTER - GREEN",           None,   None,  ""),
    ("STA-071", "HIGHLIGHTER - LAVENDER",        None,   None,  ""),
    ("STA-069", "HIGHLIGHTER - LILAC",           None,   None,  "spelling"),
    ("STA-072", "HIGHLIGHTER - ORANGE",          None,   None,  ""),
    ("STA-070", "HIGHLIGHTER - PINK",            None,   None,  ""),
    ("STA-066", "HIGHLIGHTER - RED",             None,   None,  ""),
    ("STA-073", "HIGHLIGHTER - TURQUOISE",       None,   None,  ""),
    ("STA-065", "HIGHLIGHTER - YELLOW",          None,   None,  ""),
    ("STA-074", "HIGHLIGHTER - MIXED",           None,   None,  "wording"),

    # ── Tape ────────────────────────────────────────────────────────────
    ("STA-007", "TAPE - CORRECTION",             None,   None,  ""),
    ("STA-077", "TAPE - DOUBLE SIDED - 18MM X 15M", None, None, ""),
    ("STA-061", "TAPE - DUCT - BLACK",           None,   None,  ""),
    ("STA-062", "TAPE - DUCT - BLUE",            None,   None,  ""),
    ("STA-060", "TAPE - DUCT - GREEN",           None,   None,  ""),
    ("STA-058", "TAPE - DUCT - GREY",            None,   None,  ""),
    ("STA-057", "TAPE - DUCT - RED",             None,   None,  ""),
    ("STA-059", "TAPE - DUCT - YELLOW",          None,   None,  ""),
    ("STA-076", "TAPE - TRANSPARENT - 18MM X 25M", None, None,  ""),
    ("STA-043", "TAPE CUTTER",                   None,   None,  "check"),

    # ── Clips ───────────────────────────────────────────────────────────
    ("STA-011", "CLIP - BINDER - 15MM",          None,   None,  ""),
    ("STA-012", "CLIP - BINDER - 19MM",          None,   None,  ""),
    ("STA-013", "CLIP - BINDER - 25MM",          None,   None,  ""),
    ("STA-014", "CLIP - BINDER - 32MM",          None,   None,  ""),
    ("STA-015", "CLIP - BINDER - 41MM",          None,   None,  ""),
    ("STA-016", "CLIP - BINDER - 51MM",          None,   None,  ""),
    ("STA-010", "CLIP - TRIANGLE - 25MM",        None,   None,  ""),

    # ── Staple pins ─────────────────────────────────────────────────────
    ("STA-050", "STAPLE PINS - 5MM",             "box",  None,  "check"),
    ("STA-051", "STAPLE PINS - 6.3MM",           "box",  None,  "check"),
    ("STA-047", "STAPLE PINS - 23/10",           "box",   100,  "spelling"),
    ("STA-049", "STAPLE PINS - 23/13",           "box",   100,  ""),
    ("STA-048", "STAPLE PINS - 23/17",           "box",   100,  ""),
    ("STA-045", "STAPLE PINS - 24/6",            "box",   100,  ""),
    ("STA-046", "STAPLE PINS - HEAVY DUTY",      "box",   100,  "spelling"),

    # ── Folders ─────────────────────────────────────────────────────────
    ("STA-080", "FOLDER - L-SHAPE - BLUE - A4",  "pack",  12,   ""),
    ("STA-081", "FOLDER - L-SHAPE - GREEN - A4", "pack",  12,   ""),
    ("STA-083", "FOLDER - L-SHAPE - ORANGE - A4","pack",  12,   ""),
    ("STA-078", "FOLDER - L-SHAPE - PINK - A4",  "pack",  12,   ""),
    ("STA-082", "FOLDER - L-SHAPE - PURPLE - A4","pack",  12,   ""),
    ("STA-079", "FOLDER - L-SHAPE - RED - A4",   "pack",  12,   ""),
    ("STA-085", "FOLDER - L-SHAPE - WHITE - A4", "pack",  12,   ""),
    ("STA-084", "FOLDER - L-SHAPE - YELLOW - A4","pack",  12,   ""),

    # ── Rulers ──────────────────────────────────────────────────────────
    ("STA-036", "RULER - PLASTIC - LARGE",       None,   None,  ""),
    ("STA-039", "RULER - PLASTIC - SMALL",       None,   None,  ""),
    ("STA-035", "RULER - STEEL - LARGE",         None,   None,  "spelling"),

    # ── Glue ────────────────────────────────────────────────────────────
    ("STA-063", "GLUE - LIQUID",                 None,   None,  "check"),
    ("STA-034", "GLUE - STICK",                  None,   None,  ""),

    # ── Erasers ─────────────────────────────────────────────────────────
    ("STA-008", "ERASER",                        None,   None,  ""),
    ("STA-033", "ERASER - CLIC",                 None,   None,  ""),

    # ── Pen holders ─────────────────────────────────────────────────────
    ("STA-055", "PEN HOLDER - LARGE",            None,   None,  "wording"),
    ("STA-054", "PEN HOLDER - SMALL",            None,   None,  ""),

    # ── Paper punches ───────────────────────────────────────────────────
    ("STA-044", "PAPER PUNCH - CARL",            None,   None,  "check"),
    ("STA-041", "PAPER PUNCH - D TYPE",          None,   None,  ""),

    # ── Everything else ─────────────────────────────────────────────────
    ("STA-020", "BLUE TACK - 45G",               None,   None,  ""),
    ("STA-053", "CORD - COLOURED",               None,   None,  "check"),
    ("STA-056", "CORD RING",                     None,   None,  ""),
    ("STA-040", "LIGHTER FLUID",                 None,   None,  ""),
    ("STA-037", "PENKNIFE",                      None,   None,  "check"),
    ("STA-029", "RUBBER GRIP - STABILO",         None,   None,  ""),
    ("STA-006", "SCISSORS",                      None,   None,  "spelling"),
    ("STA-009", "SHARPENER - WITH CONTAINER",    None,   None,  ""),
    ("STA-052", "STICKY NOTES - POST-IT",        None,   None,  "wording"),
    ("STA-042", "TIMER",                         None,   None,  ""),

    # ── Teaching Materials ──────────────────────────────────────────────
    ("TCH-001", "EXERCISE BOOK",                 None,   None,  ""),
    ("TCH-002", "GEOMETRY SET",                  None,   None,  ""),
    ("TCH-006", "GRAPH PAPER",                   "packet", None, "wording"),
    ("TCH-003", "PHOTO FRAME",                   None,   None,  ""),
    ("TCH-004", "PLAY CARD - COLOURED",          None,   None,  "check"),
    ("TCH-007", "PROTRACTOR",                    None,   None,  ""),
    ("TCH-005", "TRACING PAPER",                 "packet", 10,  ""),
]
