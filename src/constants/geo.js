// US tile-map geography constants. Extracted from src/ShippingSLAApp.jsx
// during PR R1. STATE_GRID positions each state on a geographic-ish grid
// (rows go N→S, cols go W→E); STATE_NAMES maps USPS codes to full names.

export const STATE_GRID = {
  AK:{r:0,c:0}, ME:{r:0,c:10},
  VT:{r:1,c:9}, NH:{r:1,c:10},
  WA:{r:1,c:1}, ID:{r:1,c:2}, MT:{r:1,c:3}, ND:{r:1,c:4}, MN:{r:1,c:5}, WI:{r:1,c:6}, MI:{r:1,c:7}, NY:{r:1,c:8}, MA:{r:1,c:11},
  OR:{r:2,c:1}, UT:{r:2,c:2}, WY:{r:2,c:3}, SD:{r:2,c:4}, IA:{r:2,c:5}, IL:{r:2,c:6}, IN:{r:2,c:7}, OH:{r:2,c:8}, PA:{r:2,c:9}, NJ:{r:2,c:10}, CT:{r:2,c:11}, RI:{r:2,c:12},
  CA:{r:3,c:1}, NV:{r:3,c:2}, CO:{r:3,c:3}, NE:{r:3,c:4}, MO:{r:3,c:5}, KY:{r:3,c:6}, WV:{r:3,c:7}, VA:{r:3,c:8}, MD:{r:3,c:9}, DE:{r:3,c:10},
  AZ:{r:4,c:2}, NM:{r:4,c:3}, KS:{r:4,c:4}, AR:{r:4,c:5}, TN:{r:4,c:6}, NC:{r:4,c:7}, SC:{r:4,c:8},
  HI:{r:5,c:0}, OK:{r:5,c:4}, LA:{r:5,c:5}, MS:{r:5,c:6}, AL:{r:5,c:7}, GA:{r:5,c:8},
  TX:{r:6,c:4}, FL:{r:6,c:8},
};

export const STATE_NAMES = {
  AL:'Alabama',AK:'Alaska',AZ:'Arizona',AR:'Arkansas',CA:'California',CO:'Colorado',CT:'Connecticut',DE:'Delaware',FL:'Florida',GA:'Georgia',HI:'Hawaii',ID:'Idaho',IL:'Illinois',IN:'Indiana',IA:'Iowa',KS:'Kansas',KY:'Kentucky',LA:'Louisiana',ME:'Maine',MD:'Maryland',MA:'Massachusetts',MI:'Michigan',MN:'Minnesota',MS:'Mississippi',MO:'Missouri',MT:'Montana',NE:'Nebraska',NV:'Nevada',NH:'New Hampshire',NJ:'New Jersey',NM:'New Mexico',NY:'New York',NC:'North Carolina',ND:'North Dakota',OH:'Ohio',OK:'Oklahoma',OR:'Oregon',PA:'Pennsylvania',RI:'Rhode Island',SC:'South Carolina',SD:'South Dakota',TN:'Tennessee',TX:'Texas',UT:'Utah',VT:'Vermont',VA:'Virginia',WA:'Washington',WV:'West Virginia',WI:'Wisconsin',WY:'Wyoming'
};
