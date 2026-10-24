// The fan zone's history and lore, club by club (24 October 2026). Only settled history lives here, through the 2025
// Final; anything since (last season, the playoffs, this season) comes from the NHL's feeds on the page itself. A club
// without an entry still gets every live section of its fan zone.

export interface ClubLore {
  colors: { primary: string; secondary: string; rgb: string };   // rgb: the primary as "r g b" for rgb(var / alpha)
  nickname: string;
  founded: string;
  arena: string;
  cups: number[];
  timeline: { year: string; title: string; text: string; big?: boolean }[];
  retired: { num: string; name: string; note: string }[];
  records: { value: string; what: string; who: string }[];
  facts: string[];
  rival: { name: string; text: string } | null;
}

export const CLUB_LORE: Record<string, ClubLore> = {
  EDM: {
    colors: { primary: '#FF4C00', secondary: '#041E42', rgb: '255 76 0' },
    nickname: 'The Oil',
    founded: '1972, in the WHA',
    arena: 'Rogers Place, Edmonton',
    cups: [1984, 1985, 1987, 1988, 1990],
    timeline: [
      { year: '1972', title: 'Born in the WHA', text: 'One of the World Hockey Association’s original clubs, as the Alberta Oilers; Edmonton Oilers from the 1973-74 season.' },
      { year: '1978', title: 'A 17-year-old arrives', text: 'Wayne Gretzky comes over from the Indianapolis Racers. Nothing in hockey is the same afterwards.', big: true },
      { year: '1979', title: 'Into the NHL', text: 'The Oilers join the NHL as the WHA merges into it.' },
      { year: '1982', title: '92 goals', text: 'Gretzky scores 92 goals in 1981-82, 50 of them in the first 39 games. Both still stand as NHL records.' },
      { year: '1984', title: 'The first Cup', text: 'The Oilers score 446 goals, still the NHL record for a season, then end the Islanders’ run of four straight Cups. Mark Messier wins the Conn Smythe.', big: true },
      { year: '1985', title: 'Back to back', text: 'A second Cup. Gretzky takes the Conn Smythe; Paul Coffey’s 37 points remain the record for a defenceman in one playoff run.' },
      { year: '1986', title: '215 points', text: 'Gretzky’s 1985-86: 163 assists and 215 points, the two highest single-season totals in NHL history.' },
      { year: '1987', title: 'Cup number three', text: 'Past the Philadelphia Flyers in seven games.' },
      { year: '1988', title: 'Four in five', text: 'A fourth Cup in five seasons; Gretzky wins the Conn Smythe again.' },
      { year: '1988', title: 'The Trade', text: 'On 9 August, Gretzky is traded to the Los Angeles Kings. A country goes into mourning.', big: true },
      { year: '1990', title: 'One for the thumb', text: 'A fifth Cup, without Gretzky, with Messier as captain and Bill Ranford in goal winning the Conn Smythe.', big: true },
      { year: '2006', title: 'The eighth seed’s run', text: 'From the last playoff spot in the West to Game 7 of the Final, lost in Carolina.' },
      { year: '2015', title: 'McDavid', text: 'After first-overall picks Taylor Hall (2010), Ryan Nugent-Hopkins (2011) and Nail Yakupov (2012), the lottery delivers Connor McDavid.' },
      { year: '2016', title: 'A new home, a young captain', text: 'Rogers Place opens, and McDavid is named captain at 19, the youngest in NHL history at the time.' },
      { year: '2017', title: 'The first Hart', text: 'McDavid wins the Hart and the Art Ross with 100 points. Hart Trophies follow in 2021 and 2023.' },
      { year: '2020', title: 'Draisaitl’s year', text: 'Leon Draisaitl wins the Hart and the Art Ross with 110 points.' },
      { year: '2023', title: '153 points', text: 'McDavid’s 64 goals and 153 points: the most points in a season in over a quarter century, with the Hart, the Art Ross and the Rocket Richard.' },
      { year: '2024', title: 'Three down, nearly all the way back', text: 'Back in the Final for the first time in 18 years. Down 3-0 to Florida, they force Game 7 and lose it 2-1. McDavid wins the Conn Smythe with 42 points, the first skater on a losing team to win it since 1976.', big: true },
      { year: '2025', title: 'Florida again', text: 'A second straight Final, lost to the Panthers in six. Draisaitl’s 52 goals had won the Rocket Richard.' },
    ],
    retired: [
      { num: '3', name: 'Al Hamilton', note: 'A defenceman from the WHA days' },
      { num: '4', name: 'Kevin Lowe', note: 'The Oilers’ first-ever NHL draft pick; six Cups' },
      { num: '7', name: 'Paul Coffey', note: 'Three Norris Trophies, two with Edmonton' },
      { num: '9', name: 'Glenn Anderson', note: 'Five Cups as an Oiler' },
      { num: '11', name: 'Mark Messier', note: 'Captain of the 1990 Cup' },
      { num: '17', name: 'Jari Kurri', note: 'Gretzky’s finisher; 71 goals in 1984-85' },
      { num: '31', name: 'Grant Fuhr', note: 'The dynasty’s goaltender' },
      { num: '99', name: 'Wayne Gretzky', note: 'The Great One' },
    ],
    records: [
      { value: '92', what: 'goals in a season (1981-82)', who: 'Wayne Gretzky' },
      { value: '215', what: 'points in a season (1985-86)', who: 'Wayne Gretzky' },
      { value: '163', what: 'assists in a season (1985-86)', who: 'Wayne Gretzky' },
      { value: '446', what: 'team goals in a season (1983-84)', who: 'The Oilers' },
      { value: '50 in 39', what: '50 goals in the first 39 games (1981-82)', who: 'Wayne Gretzky' },
      { value: '42', what: 'points in a playoff run, Conn Smythe in a losing Final (2024)', who: 'Connor McDavid' },
    ],
    facts: [
      'Five Stanley Cups in seven seasons, 1984 to 1990.',
      'The 1980s Oilers put seven players in the Hall of Fame: Gretzky, Messier, Kurri, Coffey, Anderson, Fuhr and Lowe, with Glen Sather as builder.',
      'Four first-overall picks in six drafts: Hall, Nugent-Hopkins, Yakupov and McDavid.',
      'Before Rogers Place (2016), the Oilers played at Northlands Coliseum from 1974.',
      'McDavid’s 100 assists in 2023-24 put him alongside Gretzky, Lemieux and Orr as the only players to reach 100 in a season.',
      'Back-to-back Finals in 2024 and 2025, both against the Florida Panthers.',
    ],
    rival: { name: 'The Battle of Alberta', text: 'Calgary, 300 km down Highway 2. They met in the playoffs five times between 1983 and 1991, and again in 2022, the first in 31 years, which Edmonton won in five.' },
  },
};
