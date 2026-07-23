'use strict';
// Map geometry for the in-app quest maps.
//
// Game coordinates map LINEARLY from `bounds` onto the ROTATED box — see
// mapPoint() at the bottom. Mapping onto the raw viewBox and rotating afterwards
// is equivalent at 180° and wrong at 90°, which is what made Factory misplace
// everything. Verified against tarkov.dev's own named landmarks: 100% of them
// land on drawn artwork on every map (run the app with TQT_MAPS=<dir>).
//
// GENERATED from tarkov.dev's public maps.json plus each SVG's own viewBox —
// `node _dev/build_mapdata.js`. Don't hand-edit an entry: regenerate, and diff.
// The generator is checked by reproducing the hand-verified Customs entry byte
// for byte.
//
// Map artwork: "Escape from Tarkov SVG Maps Project" by Shebuka,
// https://github.com/the-hideout/tarkov-dev-svg-maps — CC BY-NC-SA 4.0.
// Geometry, landmark names and floor extents: tarkov.dev (the-hideout), MIT.
// Full notices in THIRD-PARTY-NOTICES.txt.

const MAP_DATA = {

  "Ground Zero": {
    svg: "maps/GroundZero.svg",
    viewBox: { w: 348.92543, h: 488.44792 },
    bounds: [[249, -124], [-99, 364]], // [[x,z],[x,z]] in game coords
    rotate: 180,
    baseLayer: "Ground_Level",

    floors: [
      {
        name: "Garage", svgLayer: "Underground_Level",
        extents: [
          { height: [-1000, 21], bounds: [[[117, -100], [43, 190]], [[143, 49], [117, 80]]] },
        ],
      },
      {
        name: "2nd Floor", svgLayer: "Second_Floor",
        extents: [
          { height: [28, 32.3] },
          { height: [26, 31], bounds: [[[98, 216], [91, 228]]] },
        ],
      },
      {
        name: "3rd Floor", svgLayer: "Third_Floor",
        extents: [
          { height: [32.3, 1000] },
        ],
      },
    ],
    labels: [
      [-50, 0, "TerraGroup"], [150, 1, "Skyside"], [141, 142, "Fusion"], [14, 201, "Empire"],
      [115, 285, "Capital Insight"], [2, 324, "Nakatani"], [80, -118, "Elemental Global"],
      [115, 104, "Oasis", 22, 30], [115, 30, "ASAP Winery", 22, 27], [43, 150, "Tarbank"],
      [58, 234, "GAGRIN Hotel"], [97, 223, "M Showroom"], [-13, 48, "Science Office", 28, 28]
    ],
  },
  Factory: {
    svg: "maps/Factory.svg",
    viewBox: { w: 130.81831, h: 141.23242 },
    bounds: [[77, -64.5], [-65.5, 67.4]], // [[x,z],[x,z]] in game coords
    rotate: 90,
    baseLayer: "Ground_Floor",

    floors: [
      {
        name: "2nd Floor", svgLayer: "Second_Floor",
        extents: [
          { height: [3, 6] },
        ],
      },
      {
        name: "3rd Floor", svgLayer: "Third_Floor",
        extents: [
          { height: [6, 10000] },
        ],
      },
      {
        name: "Tunnels", svgLayer: "Basement",
        extents: [
          { height: [-10000, -1] },
        ],
      },
    ],
    labels: [
      [21, 39, "Office Building", -1, 10000], [15.5, 39, "Main Office", 6, 10000],
      [24.5, 39, "Breach Room", 6, 10000], [30.5, 39, "Locked Office", 6, 10000],
      [35, 39, "North Stairs", -1, 10000], [9, 39, "South Stairs", -1, 10000],
      [34, 26, "Sky Bridge", 6, 10000], [29.5, 17, "Connector", -1, 10000],
      [29, 41, "Locker Rooms", 3, 5], [15, 41, "Sinks", 3, 5], [20, 42, "Hole", 3, 5],
      [-3, 37, "Platform", -1, 5], [-21, 27, "Servers", 3, 5], [-18, -29, "Med Tent", -1, 2],
      [4.5, 10.5, "Silos", -1, 2], [30, -8.5, "Heli Crash", -1, 10000],
      [-1, 16, "Pit", -10000, -2], [-2, -24.5, "Underground Stash", -10000, -2],
      [-20.5, 23, "Scav Bunker", -1, 2], [-18, 50, "Blue Containers", -1, 2],
      [-45.5, 61, "Wood Room", -1, 2], [68.25, -20, "Glass Hall", -1, 2],
      [56, 5, "Boilers", -1, 5], [41, -11, "Pumping Station", -1, 5],
      [44, -36, "East Halls", -1, 2], [66, -42, "Forklifts", -1, 2],
      [18, 4, "Rafters", 6, 10000]
    ],
  },
  Customs: {
    svg: "maps/Customs.svg",
    viewBox: { w: 1062.4827, h: 535.17401 },
    bounds: [[698, -307], [-372, 237]], // [[x,z],[x,z]] in game coords
    rotate: 180,
    baseLayer: "Ground_Level",

    floors: [
      {
        name: "Underground", svgLayer: "Underground_Level",
        extents: [
          { height: [-1000, 0.5], bounds: [[[635, -137], [620, -125]], 
            [[473, -122], [458, -110]], [[314, -173], [308, -184]], [[349, -88], [323, -32]], 
            [[219, -158], [193, -137]], [[122, -61], [88, -40]]] },
        ],
      },
      {
        name: "2nd Floor", svgLayer: "Second_Floor",
        extents: [
          { height: [2.7, 6.5], bounds: [[[243, 190], [165, 125]], [[116, -83], [72, -170]], 
            [[356, -30], [341, -84]], [[334, -52], [321, -59]], [[589, 10], [577, -1]], 
            [[580, -104], [532, -134]], [[625, -120], [599, -139]]] },
          { height: [5.7, 1000], bounds: [[[580, -104], [532, -134]], 
            [[-199, -90], [-223, -131]], [[239, 3], [169, -160]], [[336, -56], [316, -95]], 
            [[584, -46], [556, -92]], [[93, 0], [65, -22]]] },
          { height: [14, 15], bounds: [[[497, -44], [450, -90]]] },
          { height: [3.9, 7.6], bounds: [[[73, 57], [22, -38]]] },
          { height: [4.4, 6.5], bounds: [[[119, -57], [100, -42]]] },
          { height: [4.6, 7.9], bounds: [[[279, -79], [246, -1.4]]] },
        ],
      },
      {
        name: "3rd Floor", svgLayer: "Third_Floor",
        extents: [
          { height: [5.7, 1000], bounds: [[[243, 190], [165, 125]]] },
          { height: [7.7, 11.3], bounds: [[[73, -73], [22, -38]]] },
          { height: [6.7, 11.6], bounds: [[[126, -64], [88, -35]]] },
          { height: [8, 11.1], bounds: [[[279, -79], [246, -1.4]]] },
        ],
      },
    ],
    labels: [
      [-215, -119, "Big Red"], [200, 150, "Dorms"], [404, 31, "New Gas"], [331, -173, "Old Gas"],
      [201, -127, "Fortress"], [83, -153, "Crackhouse"], [567, -67, "Streamer House"],
      [-69, 9, "Main Bridge"], [110, 85, "Sniper Hill"], [-288, -134, "Storage"],
      [-211, -219, "Trailer Park"], [-66, 46, "Junk Bridge"], [106, -90, "Repair Shop"],
      [491, 63, "Sniper Ridge"], [75, -9, "Old Construction"], [200, -13, "Skeleton"],
      [390, -94, "Warehouse 3"], [472, -67, "Depot"], [555, -118, "Warehouse 7"],
      [572, 0, "Military Checkpoint"], [238, 53, "Bus Station"], [333, -67, "Warehouse 4"],
      [497, 110, "Powerline Tower"], [46, -59, "Warehouse 17"]
    ],
  },
  Woods: {
    svg: "maps/Woods.svg",
    viewBox: { w: 1472.7926, h: 1420.5995 },
    bounds: [[646, -914], [-761, 442]], // [[x,z],[x,z]] in game coords
    rotate: 180,
    baseLayer: "Ground_Level",

    floors: [],
    labels: [
      [10, -3, "Sawmill"], [-485, -390, "Scav Town"], [-517, -210, "Old Sawmill"],
      [-80, -680, "Cultist Village"], [290, -475, "USEC Camp"], [-188, 235, "Military Camp"],
      [-5, -515, "Ponds"], [-252, -37, "Crash Site"], [239, -65, "Checkpoint"],
      [244, 125, "Shack"], [-16, -122, "Lumber"], [-3, -74, "Cabins"], [-234, 357, "Bus Stop"],
      [-327, 19, "Jaeger's Camp"], [85, -147, "Sniper Rock"], [200, -606, "Convoy"]
    ],
  },
  Shoreline: {
    svg: "maps/Shoreline.svg",
    viewBox: { w: 1559.5717, h: 1032.4935 },
    bounds: [[504, -415], [-1056, 618]], // [[x,z],[x,z]] in game coords
    rotate: 180,
    baseLayer: "Ground_Level",

    floors: [
      {
        name: "Underground", svgLayer: "Underground_Level",
        extents: [
          { height: [-1000, -5], bounds: [[[-137, -68], [-237, -104]], 
            [[-234, -134], [-268, -163]]] },
        ],
      },
      {
        name: "2nd Floor", svgLayer: "Second_Floor",
        extents: [
          { height: [-1, 2] },
        ],
      },
      {
        name: "3rd Floor", svgLayer: "Third_Floor",
        extents: [
          { height: [2, 1000] },
        ],
      },
    ],
    labels: [
      [-258.2, -71.2, "Resort", -4, -2], [-215.8, 178.4, "Power Station", -4, -2],
      [-189.3, 420, "Gas Station", -4, -2], [-496, 257, "Weather Station", -4, -2],
      [-708.9, 93.91, "Radio Tower", -4, -2], [326, -118.5, "Swamp", -4, -2],
      [418.4, 118, "Village", -4, -2], [288, 144, "Cabins", -4, -2],
      [128, 93, "Cottages", -4, -2], [-355, 188, "Tank Bridge", -4, -2],
      [-338.6, 525, "Pier", -4, -2], [216, 424, "Scav Island", -4, -2],
      [-96, -6, "Bus Stop", -4, -2], [52, 134, "Construction", -4, -2],
      [-153, -290, "Bunker", -4, -2], [-625, 484, "Crane", -4, -2],
      [-622, -202, "Scav Farm", -4, -2], [-171, -83, "West Wing", -100, 100],
      [-329, -83, "East Wing", -100, 100], [-252, -146, "Admin", -100, 100]
    ],
  },
  Interchange: {
    svg: "maps/Interchange.svg",
    viewBox: { w: 1127.6852, h: 947.02582 },
    bounds: [[598, -442], [-433, 426]], // [[x,z],[x,z]] in game coords
    rotate: 180,
    baseLayer: "Ground_Level",

    floors: [
      {
        name: "2nd Floor", svgLayer: "First_Floor",
        extents: [
          { height: [25, 34], bounds: [[[120, 218], [-222, -327]]] },
        ],
      },
      {
        name: "3rd Floor", svgLayer: "Second_Floor",
        extents: [
          { height: [34, 1000], bounds: [[[120, 218], [-222, -327]]] },
        ],
      },
    ],
    labels: [
      [-186.4, -318.7, "Power Station", -1, 10], [155, -253, "Go Kart", -1, 10],
      [158, -78.5, "Four Camp", -1, 10], [68.2, 312.9, "Cargo Containers", -1, 10],
      [-260.2, 123.8, "Wall Break", -1, 10], [-175.5, 145.1, "Ramps", -1, 10],
      [202.3, 219.4, "Oli Tower", -1, 10], [46.5, -358.5, "Idea Tower", -1, 10],
      [263.2, -11.1, "Scav Camp", -1, 10], [373.5, -391.2, "Highway Construction", -1, 10],
      [33, -222, "Garage A", -1000, 24], [47, -112, "Garage B", -1000, 24],
      [0, 47, "Garage C", -1000, 24], [20, 138, "Garage D", -1000, 24],
      [-34, -235, "IDEA", 25, 33], [-115, -45, "Goshan", 25, 33], [-28, 140, "OLI", 25, 33],
      [87, -165, "Nortex", 25, 33], [60, -152, "TRend", 25, 33], [69.5, -134, "Mode7", 25, 33],
      [19, -129, "TTS", 25, 33], [-38, -129, "Book Store", 25, 33],
      [91, -119, "Dino Clothes", 25, 33], [18, -103, "EMERCOM", 25, 33],
      [-28, -103, "Kostin", 25, 33], [-65, -103, "Bizarro", 25, 33], [92, -87, "Spiel", 25, 33],
      [-18, -87, "Voyage", 25, 33], [57, -66, "Viking", 25, 33], [13, -66, "Mantis", 25, 33],
      [-18, -72, "German", 25, 33], [57, -32, "The National", 25, 33],
      [13, -32, "Brutal", 25, 33], [-18, -25, "Kiba", 25, 33],
      [-34, -20, "Pretty Lights", 25, 33], [92, -18, "Telespot", 25, 33],
      [62, -12, "Revis", 25, 33], [19, -6, "ADIK", 25, 33], [-28, 0.5, "Generic", 25, 33],
      [92, 15, "Top Brand", 25, 33], [61, 15, "Sports", 25, 33], [70, 32, "Yushka", 25, 33],
      [19.5, 26, "Rasmussen", 25, 33], [-37, 26, "Avokado", 25, 33],
      [91, 55, "Boots 4 Life", 25, 33], [61, 50, "Texho", 25, 33], [6, 49, "Dom", 25, 33],
      [38, -170, "Father & Sons", 34, 999], [69, -150, "Tarkovstar", 34, 999],
      [26, -149, "Eastland", 34, 999], [71, -130, "Arena", 34, 999],
      [54, -128, "ТАРЗДРАВ", 34, 999], [20, -128, "МЕБЕЛЬ МК", 34, 999],
      [69, -116, "Intourist", 34, 999], [-27, -103, "Burger Spot", 34, 999],
      [70, -94, "FCK", 34, 999], [70, -87, "McDaniels", 34, 999], [64, -69, "Tarducks", 34, 999],
      [43, -69, "Coffee Joy", 34, 999], [15, -74, "Jacob & Jacob", 34, 999],
      [-34, -79, "ПУШКИН", 34, 999], [64, -34, "Sushi Huyushi", 34, 999],
      [-17, -32, "Underway", 34, 999], [67, -23.5, "Burger House", 34, 999],
      [-34, -24, "Philly Cute", 34, 999], [67, -16, "Shiccos", 34, 999],
      [17, 0, "МУЗЕЙ ИСТОРИИ", 34, 999], [92, 17, "Papillon", 34, 999],
      [58, 13, "ЗАКРЫТО НА РЕМОНТ", 34, 999], [70, 27, "НА-СВЯЗИ", 34, 999],
      [54, 24, "СКОРО ОТКРЫТИЕ", 34, 999], [19, 26, "Figaro", 34, 999],
      [71, 47, "АПТЕКА", 34, 999], [53, 47, "SARA", 34, 999], [26, 46, "Urban Clothes", 34, 999],
      [91, 54, "TECHLIGHT", 34, 999], [39, 67, "Fashion Store", 34, 999]
    ],
  },
  Reserve: {
    svg: "maps/Reserve.svg",
    viewBox: { w: 827.28742, h: 761.16437 },
    bounds: [[289, -274], [-303, 272]], // [[x,z],[x,z]] in game coords
    rotate: 180,
    baseLayer: "Ground_Level",

    floors: [
      {
        name: "Bunkers", svgLayer: "Bunkers",
        extents: [
          { height: [-10000, -7.27], bounds: [[[128, -208], [18, -33]], 
            [[-46, -42], [-176, 127]]] },
          { height: [-10000, -12], bounds: [[[-40, 124], [-124, 189]]] },
          { height: [-10000, 18], bounds: [[[23, 173], [-65, 189]]] },
          { height: [-7.27, -3.2], bounds: [[[74, -196], [19, -149]]] },
          { height: [-11, -4.6], bounds: [[[-246, -79], [-274, -53]], [[238, -26], [126, 45]]] },
        ],
      },
    ],
    labels: [
      [28, -102, "K Buildings"], [-25, 180, "White Queen"], [-104, 93, "White Pawn"],
      [-140, -14.5, "Black Bishop"], [-67, -30, "White Bishop"], [-49.5, 15.5, "White King"],
      [14.5, -10.8, "Black Knight"], [82.2, -30.2, "White Knight"], [149, -124, "White Rook"],
      [161, -149, "Train Station"], [-165, 57, "Black Pawn"], [167, -222, "Barracks"],
      [-220, -13, "E1 Bunkers"], [173, -3, "E2 Bunkers"], [80, -167, "д - Warehouse Bunkers"],
      [96, 30, "Garage"], [55.5, 60.6, "Mechanic"], [29.7, 29.5, "Gas Station"],
      [-31, -150, "Shipping Yard"], [-1, -71, "K1"], [66, -90, "K2"], [-5.5, -94, "K3"],
      [60, -112, "K4"], [-10.5, -115, "K5"], [54, -132, "K6"], [-8.5, 175, "Dome"],
      [-120, 37, "Tarmac"]
    ],
  },
  "Streets of Tarkov": {
    svg: "maps/StreetsOfTarkov.svg",
    viewBox: { w: 605.32395, h: 831.57753 },
    bounds: [[323, -295], [-280, 532]], // [[x,z],[x,z]] in game coords
    rotate: 180,
    baseLayer: "Ground_Level",

    floors: [
      {
        name: "Underground", svgLayer: "Underground_Level",
        extents: [
          { height: [-10000, -6] },
        ],
      },
      {
        name: "2nd Floor", svgLayer: "Second_Floor",
        extents: [
          { height: [10, 15] },
        ],
      },
      {
        name: "3rd Floor", svgLayer: "Third_Floor",
        extents: [
          { height: [15, 20] },
        ],
      },
      {
        name: "4th Floor", svgLayer: "Fourth_Floor",
        extents: [
          { height: [20, 25] },
        ],
      },
      {
        name: "5th Floor", svgLayer: "Fifth_Floor",
        extents: [
          { height: [25, 10000] },
        ],
      },
    ],
    labels: [
      [9, 308, "Primorsky Ave."], [9, 104, "Primorsky Ave."], [9, -80, "Primorsky Ave."],
      [125, 10, "Kilmov St."], [-104, 28, "Kilmov St."], [-125, 210, "Nikitskaya St."],
      [-112, 361, "Verhnyaya St."], [-200, 290, "Malevecha St."], [111, 251, "Chekannaya St."],
      [-101, 441, "Nizhnyaya St."], [174, 430, "Razvedchikov St."], [140, 150, "Zmejskij Alley"],
      [232, 100, "Kamchatskaya St."], [-128, -35, "Kilmov Shopping Mall"], [-45, -52, "Beluga"],
      [99, -71, "Cardinal Apartments"], [230, 295, "Construction"], [66, 305, "Lexos"],
      [140, 300, "Sparja Grocery"], [-175, 400, "Cinema"], [-218, 135, "Shestyorochka"],
      [-35, 64, "Pinewood Hotel"], [65, 398, "Teppakot / Koener"], [140, 362, "Concordia"],
      [89, -20, "Cardinal Bank"], [239, -60, "LERM Expo"], [-64, 166, "Sparja Express"],
      [-30, 138, "Burger Spot"], [42, 97, "Post Office"], [42, 160, "Pharmacy 1"],
      [-173, 226, "Office"], [-197, 340, "Corner Restaurant"], [-43, 335, "Pharmacy 2"],
      [90, -277, "Pharmacy 3"], [67, 230, "Tarbank"], [211, 129, "School"],
      [222, 173, "Vet Clinic"], [-212, 300, "Hive"], [-223, 279, "Family Market"],
      [-200, 248, "Marked Hotel"], [-175, 297, "South Hotel"], [-119, 287, "Abandon Factory"],
      [-80, 235, "Diner"], [-13, 244, "Primorskij 49"], [39, 230, "Prestigio Cafe"],
      [-70, 343, "Bilbo Coffee"]
    ],
  },
  Lighthouse: {
    svg: "maps/Lighthouse.svg",
    viewBox: { w: 1059.3752, h: 1722.9499 },
    bounds: [[515, -998], [-545, 725]], // [[x,z],[x,z]] in game coords
    rotate: 180,
    baseLayer: "Ground_Level",

    floors: [],
    labels: [
      [-30, -882, "Train Yard"], [-120, -841, "Drug Lab"], [-65, -600, "Water Treatment"],
      [40, -618, "Plant 1"], [-97, -737, "Plant 2"], [-189, -665, "Plant 3"],
      [-182, -552, "Pipes"], [18, -453, "Gunner Nest"], [-177, -356, "Island"],
      [-278, -323, "Cabins"], [-162, -225, "Cottages"], [-55, -288, "Convenience"],
      [-75, -284, "Red Brick"], [-151, -243, "Hillside"], [125, -153, "Boathouses"],
      [62, -60, "Dead Tree"], [0, -188, "Construction"], [-107, -53, "Pikes Peak Resort"],
      [-133, 100, "Grand Chalet"], [-70, 129, "Tennis Court"], [382, 496, "Lightkeeper Island"],
      [-125, 296, "Crash Site"]
    ],
  },
  "The Lab": {
    svg: "maps/Labs.svg",
    viewBox: { w: 720, h: 586 },
    bounds: [[-94.62, -439.31], [-290, -223.42]], // [[x,z],[x,z]] in game coords
    rotate: 270,
    baseLayer: "First_Level",
    approx: true,   // pin positions unverified — see _dev/build_mapdata.js

    floors: [
      {
        name: "Second Level", svgLayer: "Second_Level",
        extents: [
          { height: [3, 10000], bounds: [[[-101, -422], [-271, -270]]] },
        ],
      },
      {
        name: "Technical", svgLayer: "Technical_Level",
        extents: [
          { height: [-10000, -0.9] },
        ],
      },
    ],
    labels: [
      [-230, -400, "Parking", -0.8, 2], [-246, -379, "Vestibules #1", -0.8, 2],
      [-216, -379, "Vestibules #2", -0.8, 2], [-172, -342, "Main Working Area", -0.8, 2],
      [-148, -398, "Negotiation Room", -0.8, 2], [-130, -398, "Infirmary Lvl 1", -0.8, 2],
      [-130, -356, "Test Room", -0.8, 2], [-125, -308, "Server Room", -0.8, 2],
      [-116, -266, "Warehouse Tunnels", -0.8, 2], [-163, -269, "Warehouse", -0.8, 2],
      [-170, -248, "Warehouse Gate", -0.8, 2], [-207, -305, "Lecture Hall", -0.8, 2],
      [-221, -343, "Recreation Area", -0.8, 2], [-236, -302, "Gym", -0.8, 2],
      [-241, -280, "Men's Locker Room", -0.8, 2], [-232, -280, "Women's Locker Room", -0.8, 2],
      [-259, -366, "Boiler Room", -1000, 2], [-260, -319, "Security Barracks", -0.8, 2],
      [-260, -342, "Reception", -0.8, 2], [-260, -364, "Administrative Office", 3, 1000],
      [-254, -320, "Security Office", 3, 1000], [-244, -378, "Security #1", 3, 1000],
      [-215, -379, "Security #2", 3, 1000], [-229, -343, "Conference Room", 3, 1000],
      [-219, -302, "Cafeteria", 3, 1000], [-189, -401, "Offices #1", 3, 1000],
      [-149, -401, "Offices #2", 3, 1000], [-130, -401, "Infirmary Lvl 2", 3, 1000],
      [-130, -361, "Sterile Laboratory", 3, 1000], [-169, -288, "Control Room", 3, 1000],
      [-250, -281, "Corridor To Building #2", 3, 1000]
    ],
  },
  "The Labyrinth": {
    svg: "maps/Labyrinth.svg",
    viewBox: { w: 4800, h: 4320 },
    bounds: [[-62.79, -69.47], [70.09, 78.68]], // [[x,z],[x,z]] in game coords
    rotate: 0,
    orient: "vu",   // axis mapping (see mapPoint)
    baseLayer: "Base",
    approx: true,   // pin positions unverified — see _dev/build_mapdata.js
    credit: "Map by re3mr — reemr.se",   // per-map artwork credit

    floors: [],
    labels: [],
  },
  Terminal: {
    svg: "maps/Terminal.svg",
    viewBox: { w: 887.70096, h: 1043.9554 },
    bounds: [[463, -580], [-433, 475]], // [[x,z],[x,z]] in game coords
    rotate: 180,
    baseLayer: "Ground_Level",

    floors: [],
    labels: [],
  },
};

const norm360 = (deg) => (((deg || 0) % 360) + 360) % 360;

// The rotation is baked into the SVG at load time rather than applied as a CSS
// transform, so that everything downstream — pins, labels, cards, clamping —
// works in the coordinates the user actually sees. These two say what that
// space looks like. (A 90°/270° map is taller than it is wide once turned, so
// the box swaps: Factory is the only one today.)
function rotatedViewBox(md) {
  const { w, h } = md.viewBox;
  const r = norm360(md.rotate);
  return (r === 90 || r === 270)
    ? { x: (w - h) / 2, y: (h - w) / 2, w: h, h: w }
    : { x: 0, y: 0, w, h };
}

// Game (x,z) -> where it appears on the displayed map.
//
// The mapping is onto the ROTATED box, not the raw viewBox. That distinction is
// invisible on a 180° map (the box is unchanged) but decides everything on a 90°
// one: Factory's game x:z ratio is 1.080, which matches its rotated box exactly
// and its raw viewBox not at all. Mapping onto the raw box and then rotating
// swaps the two axes and squashes the map by 17%.
//
// The axis assignment is 'UV' — game x drives the horizontal, game z the
// vertical, both flipped — on EVERY map, because `bounds` are already stated in
// the map's display frame. The rotation moves the artwork, never the axes. That
// was measured, not assumed: hit-testing each map's landmark labels against the
// artwork underneath scores 100% on all nine labelled maps with 'UV', while the
// rotation-derived assignment 'Vu' scores 52% on Factory. `orient` stays as a
// per-map override if a future map ever disagrees; the codes are 'u' = game x,
// 'v' = game z, upper case = flipped.
function mapPoint(md, x, z) {
  const [[x1, z1], [x2, z2]] = md.bounds;
  const u = (x - x1) / (x2 - x1);
  const v = (z - z1) / (z2 - z1);
  const d = rotatedViewBox(md);
  const o = md.orient || 'UV';
  const pick = (ch) => (ch === 'u' ? u : ch === 'U' ? 1 - u : ch === 'v' ? v : 1 - v);
  return { x: d.x + pick(o[0]) * d.w, y: d.y + pick(o[1]) * d.h };
}

// is (x,z) inside a [[ax,az],[bx,bz]] rectangle (corners in either order)
function inRect(x, z, rect) {
  const [[ax, az], [bx, bz]] = rect;
  return x >= Math.min(ax, bx) && x <= Math.max(ax, bx)
    && z >= Math.min(az, bz) && z <= Math.max(az, bz);
}

// which floor a point belongs to: index into md.floors, or -1 for ground
function floorOf(md, x, y, z) {
  for (let i = 0; i < md.floors.length; i++) {
    for (const ex of md.floors[i].extents) {
      const [hMin, hMax] = ex.height;
      if (y < hMin || y > hMax) continue;
      if (!ex.bounds || ex.bounds.some((r) => inRect(x, z, r))) return i;
    }
  }
  return -1;
}

// How high a floor sits, for ordering the tabs bottom-to-top. Upstream lists
// floors in no particular order — The Lab reads "Second Level, Technical" — and
// ground is a separate concept (index -1) that belongs in the MIDDLE of a map
// with a basement, not permanently on the left.
//
// Height ranges use ±1000/±10000 as open-ended sentinels, so clamp before taking
// a midpoint: an underground extent of [-1000, 0.5] must not drag its floor's
// average to -500 and a top floor's [5.7, 1000] must not send it to +500. Ground
// is 0 by definition.
function floorHeight(floor) {
  const mids = (floor.extents || []).map((e) => {
    const lo = Math.max(-60, Math.min(60, e.height[0]));
    const hi = Math.max(-60, Math.min(60, e.height[1]));
    return (lo + hi) / 2;
  });
  if (!mids.length) return 0;
  return mids.reduce((a, b) => a + b, 0) / mids.length;
}

// [{ name, idx }] for the floor tabs, lowest first; idx -1 is the ground floor
function floorOrder(md) {
  const tabs = [{ name: 'Ground', idx: -1, h: 0 }].concat(
    (md.floors || []).map((f, i) => ({ name: f.name, idx: i, h: floorHeight(f) })));
  return tabs.sort((a, b) => a.h - b.h || a.idx - b.idx);
}

if (typeof module !== 'undefined') {
  module.exports = { MAP_DATA, mapPoint, rotatedViewBox, inRect, floorOf, floorHeight, floorOrder };
}
