// The past-season paste parser (src/lib/historyPaste.ts): tables copied from Yahoo, ESPN, Fantrax, CBS, a sheet or an
// email, each line a team, top to bottom.
import assert from 'node:assert/strict';
import { parsePastedTable } from '../../src/lib/historyPaste.ts';

const eq = (text, want, what) => { assert.deepEqual(parsePastedTable(text), want, what); console.log('ok:', what); };

eq('1\tThe Hip Czechs\tPatrick\t1,234.5\n2\tEagle Palace\tCraig\t1,198.0',
  [{ team_name: 'The Hip Czechs', gm_name: 'Patrick', points: '1234.5' }, { team_name: 'Eagle Palace', gm_name: 'Craig', points: '1198' }],
  'tabs, a place in front, thousands');
eq('Rank\tTeam\tRecord\tPts\n1\tPuck Bunnies (Jason)\t10-3-1\t1023.4',
  [{ team_name: 'Puck Bunnies', gm_name: 'Jason', points: '1023.4' }], 'a header line, Team (GM), a W-L-T record');
eq('Rank,Team,GM,Points\n1,Ice Holes,Craig,987.6\n2, Sin Bin , Todd , 950',
  [{ team_name: 'Ice Holes', gm_name: 'Craig', points: '987.6' }, { team_name: 'Sin Bin', gm_name: 'Todd', points: '950' }], 'comma separated');
eq('1.  Ice Holes    Craig    987.6\n2.  Sin Bin    Todd    950.25',
  [{ team_name: 'Ice Holes', gm_name: 'Craig', points: '987.6' }, { team_name: 'Sin Bin', gm_name: 'Todd', points: '950.25' }], 'wide spaces');
eq('1. Ice Holes 987.6\n2nd Sin Bin 950',
  [{ team_name: 'Ice Holes', gm_name: '', points: '987.6' }, { team_name: 'Sin Bin', gm_name: '', points: '950' }], 'one space: place, name, points');
eq('1\tTeam Moose\tDan\t1100\t$400', [{ team_name: 'Team Moose', gm_name: 'Dan', points: '1100' }], 'a money column is not points');
eq('\n\n  \nThe Mighty Ducks\n', [{ team_name: 'The Mighty Ducks', gm_name: '', points: '' }], 'blank lines, a name alone');
eq('T-3\t2 Good 2 Be True\tPan\t880', [{ team_name: '2 Good 2 Be True', gm_name: 'Pan', points: '880' }], 'a tied place, a name with numbers');
eq('Team A, Bob, 1,234.5\nTeam B, Sue, 998', [{ team_name: 'Team A', gm_name: 'Bob', points: '1234.5' }, { team_name: 'Team B', gm_name: 'Sue', points: '998' }],
  'commas between fields and a thousands comma in the points');
eq('"Rank","Team","GM","Points"\n"1","Team A","Bob","1,234.5"\n"2","Smith, Jones & Co","Ann","1,100"',
  [{ team_name: 'Team A', gm_name: 'Bob', points: '1234.5' }, { team_name: 'Smith, Jones & Co', gm_name: 'Ann', points: '1100' }], 'quoted CSV, commas inside quotes');
console.log('history paste parser passed');
