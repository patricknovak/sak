# The four sport pages' words. Facts from research/product-inventory.md (4 November 2026) and the brief, sections 6 and 7.
import html

A = 'https://app.superpoolsai.com/#/new?'
def a(q):
    return html.escape(A + q, quote=True)

MONEY_Q = 'Is there any real money in it?'
APP_Q = 'Do my friends need an app?'
APP_A = 'No. They tap your link and join with just a name, in the browser on any phone. Add it to the Home Screen for alerts if you like.'

GENERIC_PROOF = lambda lock, end: [
    ('target', f'<b>Scored from public score feeds.</b> Every pick locks at its own {lock} and settles as {end}.'),
    ('users', "<b>The pool's split shows after each lock, never before,</b> so nobody copies the room."),
    ('shield', '<b>A result the feed gets wrong,</b> your host can set for the pool alone, with the reason on the record.'),
]

# ---------------------------------------------------------------- football
FOOTBALL_DEMO = '''        <figure class="scr pk rv" aria-label="A sample pick'em week">
          <span class="sample-cap">Sample pool</span>
          <div class="scr-head"><b>This week</b><span class="live">Live</span></div>
          <div class="sub2"><span>The Office Pool · against the spread</span><span><b>2 of 2</b> right · 2nd of 9</span></div>
          <ol class="pk-list">
            <li class="pk-g"><span class="mk y" aria-label="Right">✓</span><div class="pk-t"><span class="tm me">BUF<i>-2.5</i></span><span class="at">@</span><span class="tm">MIA</span></div><div class="pk-s"><b>27-20</b><small>Final</small></div><div class="pk-sp"><span class="bar2"><i style="--w:78%"></i></span><span>7 of 9 took BUF</span></div></li>
            <li class="pk-g"><span class="mk y" aria-label="Right">✓</span><div class="pk-t"><span class="tm">KC</span><span class="at">@</span><span class="tm me">DEN<i>+3.5</i></span></div><div class="pk-s"><b>24-23</b><small>Final</small></div><div class="pk-sp"><span class="bar2"><i style="--w:33%"></i></span><span>3 of 9 took DEN</span></div></li>
            <li class="pk-g now"><span class="mk o" aria-label="Under way"></span><div class="pk-t"><span class="tm me">PHI<i>-1.5</i></span><span class="at">@</span><span class="tm">DAL</span></div><div class="pk-s"><b>17-10</b><small>3rd, 6:12</small></div><div class="pk-sp"><span class="bar2"><i style="--w:67%"></i></span><span>6 of 9 took PHI</span></div></li>
            <li class="pk-g"><span class="mk w" aria-label="Still to play"></span><div class="pk-t"><span class="tm">SF</span><span class="at">@</span><span class="tm me">SEA<i>+2.5</i></span></div><div class="pk-s"><b>4:25</b><small>Sun, ET</small></div><div class="pk-sp hid"><span>The split shows at kickoff</span></div></li>
          </ol>
          <div class="pk-foot"><span>Tiebreaker · Monday night's total</span><b>Your call: 47</b></div>
          <figcaption>Sample pool · names and lines made up</figcaption>
        </figure>'''

FOOTBALL = dict(
    slug='football-pools', src='football', sport='nfl', ghosts=1,
    title="NFL Pick'em, Squares and Prop Sheets | Super Pools",
    desc="Free NFL pools for your group chat: pick'em straight up or against the spread, last one standing, squares and prop sheets on any game. Never money.",
    og_title='The NFL pool that scores itself',
    og_desc="Pick'em, last one standing and streaks on every NFL week, squares and prop sheets on any game. Supercoins. Never money.",
    h1='The NFL pool <span class="l2"><em>that scores itself.</em></span>',
    sub="Pick'em, last one standing and streaks on every NFL week. Squares and prop sheets on any game.",
    cta='comp=nfl&kind=pickem&src=football', cta_label='Start an NFL pool', demo_link='See a sample week',
    proof_icon='check',
    proofline="Settled from the scores: every pick locks at kickoff, the table moves as games end, and the pool's split shows after the lock, never before.",
    now_tag='From the app', now_p='The NFL as it stands, with the next kickoff counting down.',
    kinds_h2='Seven ways to play the NFL.',
    kinds_lead='Tap one and the start page opens on it, from the next game still to come.',
    kinds=[
        dict(href=a('comp=nfl&kind=pickem&src=football'), icon='check', name="Pick'em", line="Every game of the week, straight up or confidence-ranked. A tiebreaker on the week's last game.", tag='NFL'),
        dict(href=a('comp=nfl&kind=pickem&ats=1&src=football'), icon='target', name='Against the spread', line='Pick who covers. Each pick keeps the line it was made at.', tag='NFL'),
        dict(href=a('comp=nfl&kind=survivor&src=football'), icon='shield', name='Last one standing', line='One team a week, never the same one twice. Up to three lives.', tag='NFL'),
        dict(href=a('comp=nfl&kind=props&src=football'), icon='sheet', name='The prop sheet', line='Eight calls on one game, a point each, settled as it plays.', tag='NFL'),
        dict(href=a('comp=nfl&kind=squares&src=football'), icon='grid', name='Squares', line='A grid on any game this week, scored by the quarter in Supercoins.', tag='NFL'),
        dict(href=a('comp=nfl&kind=streak&src=football'), icon='flame', name='Daily streak', line='One pick a game day. The longest run of right picks wins.', tag='NFL'),
        dict(href=a('pack=nfl-2026&src=football'), icon='q', name="The season's questions", line="The Super Bowl, each conference and MVP, with the group's chance on every answer. Opens beside pick'em; untick it for questions alone.", tag='NFL'),
        dict(icon='bracket', name='Playoff pools', line='The bracket, a pick on every playoff game, the Eliminator, prop sheets and squares.',
             when=[('Opens in January', {'data-until': '2027-01-09T05:00:00Z'}), ('Opens with the playoffs', {'data-from': '2027-01-09T05:00:00Z'})]),
    ],
    steps_h2='Three steps to Sunday.',
    steps=[
        ('Start it, send one link', 'Pick the pool, name it and drop the link in the group chat. Friends join with just a name, in the browser.'),
        ('Pick before kickoff', "Each pick locks at its own kickoff, so Thursday locks Thursday and Sunday stays open. A reminder goes out before each week's games, and again before Sunday's."),
        ('It settles itself', 'Results land as each game goes final, overtime included. The table moves and someone takes the crown.'),
    ],
    demo_h2='Your week, one card.',
    demo_lead="Every pick keeps its line, finished games mark themselves, and the room's split appears only once a game locks.",
    demo_fine='\n          <p class="fine">Lines are for picking, and points are all they score.</p>',
    demo=FOOTBALL_DEMO,
    proof_h2='Built by a league.',
    proof=GENERIC_PROOF('kickoff', 'the game goes final'),
    faq=[
        (MONEY_Q, 'No. Pools are played for points and a crown. Supercoins are never bought, never sold, never turned into money.'),
        (APP_Q, APP_A),
        ('How does against the spread work?', 'Switch it on when you start the pool. Each pick keeps the line it was made at, so a line that moves later never changes it, and a pick that lands right on the number is a tie, and scores nothing.'),
        ('What breaks a tie?', "Each week has a tiebreaker: the total points in its last game. Level on the week, the closest call takes it."),
        ('What if someone forgets to pick?', 'Switch on the favourite for a missed pick, and a game nobody picked takes the favourite at kickoff. In last one standing, give everyone up to three lives.'),
        ('What about the playoffs?', 'They open in January: the bracket, a pick on every playoff game, the Eliminator, prop sheets and squares. Start one the day they open.'),
    ],
    close_h2='Start yours before kickoff.',
    close_p='A minute to set up, one link for the group chat, and friends join with just a name.',
    close_link=('Every kind of pool', './#kinds'),
    league_note='Not affiliated with the NFL or any team.',
)

# ---------------------------------------------------------------- hockey
HOCKEY_DEMO = '''        <figure class="scr bx rv" aria-label="A sample box pool entry">
          <span class="sample-cap">Sample pool</span>
          <div class="scr-head"><b>Your entry</b><span class="live">Live</span></div>
          <div class="sub2"><span>The Rink Pool · Quick, five boxes</span><span>Tonight <b>+6</b></span></div>
          <ol class="bx-list">
            <li><span class="bx-n"><small>Box</small><b>1</b></span><div class="bx-p">MacKinnon <span>COL · Final · 1G 1A</span></div><span class="bx-pts">2</span><span class="bx-o">Forwards · also McDavid, Kucherov, Matthews, Draisaitl</span></li>
            <li class="now"><span class="bx-n"><small>Box</small><b>2</b></span><div class="bx-p">Kaprizov <span>MIN · 2nd, 8:14 · 1A</span></div><span class="bx-pts">1</span><span class="bx-o">Forwards · also Pastrnak, Rantanen, Eichel, Point</span></li>
            <li><span class="bx-n"><small>Box</small><b>3</b></span><div class="bx-p">Batherson <span>OTT · 10:00 pm</span></div><span class="bx-pts z">0</span><span class="bx-o">Forwards · also Hischier, Tkachuk, Zibanejad, Larkin</span></li>
            <li><span class="bx-n"><small>Box</small><b>4</b></span><div class="bx-p">Makar <span>COL · Final · 1A</span></div><span class="bx-pts">1</span><span class="bx-o">Defence · also Hughes, Werenski, Fox, Hedman</span></li>
            <li><span class="bx-n"><small>Box</small><b>5</b></span><div class="bx-p">Hellebuyck <span>WPG · Final · W</span></div><span class="bx-pts">2</span><span class="bx-o">Goalies · also Shesterkin, Vasilevskiy, Sorokin, Oettinger</span></li>
          </ol>
          <div class="bx-tab">
            <div class="label"><span>The table</span><span>24 entries</span></div>
            <div class="bx-row"><span class="rk">1</span><span>Five Hole Heroes</span><span class="tot">48</span><span class="mv">+3</span></div>
            <div class="bx-row me"><span class="rk">2</span><b>Your entry</b><span class="tot">45</span><span class="mv">▲ 1 · +6</span></div>
            <div class="bx-row"><span class="rk">3</span><span>Zamboni Drivers</span><span class="tot">43</span><span class="mv">▼ 1 · +2</span></div>
          </div>
          <p class="bx-rule">Goal 1 · Assist 1 · Goalie win 2 · Shutout 1 · times Eastern</p>
          <figcaption>Sample pool · names made up</figcaption>
        </figure>'''

HOCKEY = dict(
    slug='hockey-pools', src='hockey', sport='nhl', ghosts=2,
    title='Hockey Pools and the NHL Box Pool | Super Pools',
    desc="Start a hockey box pool tonight: one player a box, goals, assists and goalie wins live. Pick'em, last one standing and the streak too. Never money.",
    og_title='The box pool, live tonight',
    og_desc='One player a box. Goals, assists and goalie wins live from the next puck drop. Poolies join with a name. Never money.',
    h1='The box pool, <span class="l2"><em>live tonight.</em></span>',
    sub='One player a box. Goals, assists and goalie wins live from the next puck drop. Join with a name.',
    cta='comp=nhl-2026&kind=players&src=hockey', cta_label='Start a box pool', demo_link='See an entry',
    proof_icon='box',
    proofline="Points move with every goal from the NHL's box scores, the feed that scores the SaK Superleague each night.",
    now_tag='From the app', now_p="Tonight's NHL, straight from the app. Entries lock at the first puck drop.",
    kinds_h2='The box pool, and four more.',
    kinds_lead='Every one runs on the 2026-27 season. Tap one and the start page opens on it.',
    kinds=[
        dict(href=a('comp=nhl-2026&kind=players&src=hockey'), icon='box', name='The box pool', line='One player from each box, any number of poolies. A week, four weeks or the rest of the season.', tag='NHL'),
        dict(href=a('comp=nhl-2026-27&kind=pickem&src=hockey'), icon='check', name="Pick'em", line='Every game of the week, straight up or confidence-ranked.', tag='NHL'),
        dict(href=a('comp=nhl-2026-27&kind=survivor&src=hockey'), icon='shield', name='Last one standing', line='One team a week, never the same one twice. Up to three lives.', tag='NHL'),
        dict(href=a('comp=nhl-2026-27&kind=streak&src=hockey'), icon='flame', name='Daily streak', line='One pick a night. The longest run of right picks wins.', tag='NHL'),
        dict(href=a('pack=nhl-2026-27&src=hockey'), icon='q', name="The season's questions", line="The Cup, the Presidents' Trophy and the scoring races, with the group's chance on every answer. Opens beside pick'em; untick it for questions alone.", tag='NHL'),
    ],
    cal_label='On the calendar',
    cal=[
        # a box pool for "the rest of the season" can start any night, its boxes dealt that day (migration 188)
        dict(attrs={'data-until': '2027-02-08T05:00:00Z'}, href=a('comp=nhl-2026&kind=players&src=hockey'), icon='box', name='The second-half box pool',
             line='A fresh box pool any night: start one in January for the second half, its boxes dealt the day it starts.', tag='NHL'),
        dict(attrs={'data-until': '2027-04-11T04:00:00Z'}, icon='bracket', name='Playoff pools', line='The playoff box pool before round 1, the bracket, pick the series, prop sheets and squares by period.',
             when=[('Opens in April', {})]),
        dict(attrs={'data-from': '2027-04-11T04:00:00Z', 'data-until': '2027-06-01T04:00:00Z'}, href=a('src=hockey'), icon='bracket', name='Playoff pools',
             line='The playoff box pool before round 1, the bracket, pick the series, prop sheets and squares by period.', tag='Playoffs'),
    ],
    more='''
      <p class="kl-more"><span>Keeper league? Keepers, the draft room with a clock and a league voice live on the fantasy side.</span><a class="textlink" href="./fantasy-hockey.html">Bring your keeper league</a></p>''',
    steps_h2='Three steps to puck drop.',
    steps=[
        ('Start it, send one link', 'Pick Classic, ten boxes of six, or Quick, five of five, and drop the link in the group chat. Poolies join with just a name.'),
        ('One player a box', "Each poolie takes one player from every box before the deadline: the first puck drop of the pool's first night."),
        ('It counts itself', 'Goals, assists, goalie wins and shutouts land live from the box scores. The winner is named the morning after the last night.'),
    ],
    demo_h2='One entry, five boxes.',
    demo_lead='Your picks, what each scored tonight and where the entry sits. The same player can be on every entry, so nobody needs a draft night.',
    demo=HOCKEY_DEMO,
    proof_h2='Built by a league.',
    proof=[
        ('stick', "<b>1,344 regular-season games this season,</b> each scored as it goes final from the NHL's box scores."),
        ('clock', '<b>Every finished game is re-checked</b> for three days, and every Monday for the last three weeks.'),
        ('shield', "<b>Pick'em, last one standing and the streak</b> settle from public score feeds, and your host can set a result for the pool alone, with the reason on the record."),
    ],
    faq=[
        ('Is there any money in it?', 'No. Entries play for points and a crown, and Supercoins are never bought, never sold, never turned into money. If your pool collects dues, that stays between friends.'),
        ('How does the box pool work?', 'The top players are dealt into evenly matched boxes: forwards, then defence, then goalies. Each poolie takes one from every box. A goal or an assist is a point, a goalie win two, a shutout one, and the host can change them before the deadline.'),
        ('When is the deadline?', "The first puck drop of the pool's first night. Every entry locks then, and the table counts live for a week, four weeks or the rest of the season."),
        ('Can two poolies take the same player?', 'Yes. Boxes are not a draft, so the same player can be on every entry, and any number of poolies can play.'),
        ('Is there a playoff pool?', 'In April: the playoff box pool before round 1, dealt on expected playoff games, plus the bracket, pick the series, prop sheets, squares by period and the sweepstake.'),
        ('We run a keeper league. Is that here too?', 'Yes, on the fantasy side: keepers, the draft room with a clock, live points at every puck drop and a league voice. <a href="./fantasy-hockey.html">Bring your league.</a>'),
    ],
    close_h2='Your pool, live tonight.',
    close_p='A minute to set up, one link for the group chat, and poolies join with just a name.',
    close_link=('Bring your keeper league', './fantasy-hockey.html'),
    league_note='Not affiliated with the NHL or any club.',
)

# ---------------------------------------------------------------- basketball
BASKETBALL_DEMO = '''        <figure class="scr lt rv" aria-label="A sample pick'em table as two games go final">
          <span class="sample-cap">Sample pool</span>
          <div class="scr-head"><b>Week 3 table</b><span class="live">Live</span></div>
          <div class="sub2"><span>The Group Chat · pick'em</span><span>9 entries</span></div>
          <div class="lt-cols"><span>#</span><span>Entry</span><span>Right</span><span>Max</span></div>
          <div class="lt-body">
            <ol class="lt-rk" aria-hidden="true"><li>1</li><li>2</li><li>3</li><li>4</li><li>5</li></ol>
            <ol class="lt-rows">
              <li class="lt-row"><span class="nm">Downtown</span><span class="v"><i>21</i></span><span class="mx"><i>27</i></span></li>
              <li class="lt-row dn"><span class="nm">Fadeaway Club</span><span class="v"><i>19</i></span><span class="mx"><i class="a0">25</i><i class="a1">23</i></span></li>
              <li class="lt-row up me"><span class="nm">Your entry</span><span class="v"><i class="a0">18</i><i class="a1">20</i></span><span class="mx"><i>26</i></span></li>
              <li class="lt-row"><span class="nm">Hack-a-Pal</span><span class="v"><i>16</i></span><span class="mx"><i>22</i></span></li>
              <li class="lt-row"><span class="nm">The Bench<small class="out">Can't catch first</small></span><span class="v"><i>12</i></span><span class="mx"><i>18</i></span></li>
            </ol>
          </div>
          <div class="lt-ev" aria-live="off"><span class="a0">BOS @ NYK and DEN @ PHX, both in the 4th</span><span class="a1"><b>Both final.</b> You had both; Fadeaway Club had neither.</span></div>
          <figcaption>Sample pool · names made up</figcaption>
        </figure>'''

BASKETBALL = dict(
    slug='basketball-pools', src='basketball', sport='nba', ghosts=1,
    title="NBA Pools: Pick'em and the Daily Streak | Super Pools",
    desc="Free NBA pools for your group chat: pick'em on every game, last one standing each week, a daily streak and the season's questions. Never money.",
    og_title='The NBA pool that scores itself',
    og_desc="Pick'em on every NBA game, last one standing each week and a daily streak, one pick a night. Supercoins. Never money.",
    h1='The NBA pool <span class="l2"><em>that scores itself.</em></span>',
    sub="Pick'em on every NBA game, last one standing each week and a daily streak, one pick a night.",
    cta='comp=nba-2026-27&kind=pickem&src=basketball', cta_label='Start an NBA pool', demo_link='Watch a table move',
    proof_icon='check',
    proofline="Settled from the scores: every pick locks at tip-off, the table moves as games end, and the pool's split shows after the lock, never before.",
    now_tag='From the app', now_p="The NBA as it stands, with tonight's first tip-off counting down.",
    kinds_h2='Five ways to play the NBA.',
    kinds_lead='Tap one and the start page opens on it, from the next game still to come.',
    kinds=[
        dict(href=a('comp=nba-2026-27&kind=pickem&src=basketball'), icon='check', name="Pick'em", line='Every game of the week, straight up or confidence-ranked.', tag='NBA'),
        dict(href=a('comp=nba-2026-27&kind=pickem&ats=1&src=basketball'), icon='target', name='Against the spread', line='Pick who covers. Each pick keeps the line it was made at; pick on game day, once the line is out.', tag='NBA'),
        dict(href=a('comp=nba-2026-27&kind=survivor&src=basketball'), icon='shield', name='Last one standing', line='One team a week, never the same one twice. Up to three lives.', tag='NBA'),
        dict(href=a('comp=nba-2026-27&kind=streak&src=basketball'), icon='flame', name='Daily streak', line='One pick a night. The longest run of right picks wins.', tag='NBA'),
        dict(href=a('pack=nba-2026-27&src=basketball'), icon='q', name="The season's questions", line="The title, the NBA Cup, MVP and Rookie of the Year, with the group's chance on every answer. Opens beside pick'em; untick it for questions alone.", tag='NBA'),
    ],
    cal_label='On the calendar',
    cal=[
        dict(attrs={'data-until': '2027-04-15T04:00:00Z'}, icon='bracket', name='Playoff pools', line='The bracket, pick the series, prop sheets, squares by quarter and the sweepstake.',
             when=[('Opens mid-April', {})]),
        dict(attrs={'data-from': '2027-04-15T04:00:00Z', 'data-until': '2027-06-01T04:00:00Z'}, href=a('src=basketball'), icon='bracket', name='Playoff pools',
             line='The bracket, pick the series, prop sheets, squares by quarter and the sweepstake.', tag='Playoffs'),
        dict(icon='chart', name='Win totals', line="Over or under on every club's season wins. They lock at opening night.",
             when=[('Opens before next season', {})]),
    ],
    more='''
      <p class="fine">Lines are for picking, and points are all they score.</p>''',
    steps_h2='Three steps to tip-off.',
    steps=[
        ('Start it, send one link', 'Pick the pool, name it and drop the link in the group chat. Friends join with just a name, in the browser.'),
        ('Pick before tip-off', "Each pick locks at its own tip-off, so a late joiner still plays every game left. A reminder goes out before each week's games."),
        ('It settles itself', 'Results land as each game goes final, overtime included. The table moves, and a climb rings the phone.'),
    ],
    demo_h2='The table moves as games end.',
    demo_lead='Two games go final and the entries change places, each with the most it can still reach and who can no longer catch first.',
    demo=BASKETBALL_DEMO,
    proof_h2='Built by a league.',
    proof=GENERIC_PROOF('tip-off', 'the game goes final'),
    faq=[
        (MONEY_Q, 'No. Pools are played for points and a crown. Supercoins are never bought, never sold, never turned into money.'),
        (APP_Q, APP_A),
        ('Which pool should we play?', "For a group that watches every night, the daily streak. For the office, weekly pick'em or last one standing."),
        ('Can we start one now?', 'Yes. A pool plays from the next game still to come, and each pick locks at its own tip-off, so nobody is late for the games left.'),
        ('What about win totals?', 'They lock at opening night, so they closed on 20 October for this season. They open again before the next one.'),
        ('When do playoff pools open?', 'In mid-April: the bracket, pick the series, prop sheets, squares by quarter and the sweepstake.'),
    ],
    close_h2='Start yours before tip-off.',
    close_p='A minute to set up, one link for the group chat, and friends join with just a name.',
    close_link=('Every kind of pool', './#kinds'),
    league_note='Not affiliated with the NBA or any team.',
)

# ---------------------------------------------------------------- soccer
SOCCER_DEMO = '''        <figure class="scr cs rv" aria-label="A sample Call the score matchweek">
          <span class="sample-cap">Sample pool</span>
          <div class="scr-head"><b>Matchweek calls</b><span class="live">Live</span></div>
          <div class="sub2"><span>Sunday League · Call the score</span><span><b>7</b> points so far</span></div>
          <ol class="cs-list">
            <li class="cs-m"><div class="cs-sc"><span class="c">ARS</span><span class="n">2</span><span class="n">1</span><span class="c">CHE</span></div><span class="cs-st">Full time</span><div class="cs-call"><b>2-1</b><small class="bk">Banker</small></div><div class="cs-pts y">6<small>exact x2</small></div></li>
            <li class="cs-m"><div class="cs-sc"><span class="c">NEW</span><span class="n">0</span><span class="n">2</span><span class="c">TOT</span></div><span class="cs-st">Full time</span><div class="cs-call"><b>1-2</b><small>Your call</small></div><div class="cs-pts">1<small>result</small></div></li>
            <li class="cs-m now"><div class="cs-sc"><span class="c">LIV</span><span class="n">1</span><span class="n">1</span><span class="c">MCI</span></div><span class="cs-st">67'</span><div class="cs-call"><b>2-1</b><small>Your call</small></div><div class="cs-pts z">0<small>for now</small></div></li>
            <li class="cs-m"><div class="cs-sc"><span class="c">AVL</span><span class="n">–</span><span class="n">–</span><span class="c">MUN</span></div><span class="cs-st">Sat 10:00 am ET</span><div class="cs-call"><b>1-1</b><small>Your call</small></div><div class="cs-pts z">·<small>to come</small></div></li>
          </ol>
          <div class="pk-foot"><span>Exact 3 · Result 1 · Banker x2</span><b>2nd of 12</b></div>
          <figcaption>Sample pool · names made up</figcaption>
        </figure>'''

SOCCER = dict(
    slug='soccer-pools', src='soccer', sport='soccer', ghosts=2,
    title="Soccer Pools: Call the Score and Pick'em | Super Pools",
    desc="Free soccer pools on the Premier League, MLS, the WSL and the NWSL: Call the score, pick'em, last one standing and streaks. Never money.",
    og_title='Call the score. It settles itself.',
    og_desc="Exact scores, pick'em and last one standing on the Premier League, MLS, the WSL and the NWSL. Supercoins. Never money.",
    h1='Call the score. <span class="l2"><em>It settles itself.</em></span>',
    sub="Exact scores, pick'em and last one standing on the Premier League, MLS, the WSL and the NWSL.",
    cta='comp=epl&kind=score&src=soccer', cta_label='Start a soccer pool', demo_link='See a matchweek',
    proof_icon='check',
    proofline="Settled from the scores: every call locks at kick-off, the table moves as matches end, and the pool's split shows after the lock, never before.",
    now_tag='From the app', now_p='Every competition open now, with the next kick-off counting down.',
    kinds_h2='Five ways to play a matchweek.',
    kinds_lead='Tap one and the start page opens on it in the Premier League, from the next matchweek still to come.',
    kinds=[
        dict(href=a('comp=epl&kind=score&src=soccer'), icon='target', name='Call the score', line='The exact score of every match: 3 for the score, 1 for the result, one banker doubled.', tag='EPL'),
        dict(href=a('comp=epl&kind=pickem&src=soccer'), icon='check', name="Pick'em", line='Home, draw or away on every match of the matchweek.', tag='EPL'),
        dict(href=a('comp=epl&kind=survivor&src=soccer'), icon='shield', name='Last one standing', line="One club to win each matchweek, never the same one twice. A draw or a loss and you're out.", tag='EPL'),
        dict(href=a('comp=epl&kind=streak&src=soccer'), icon='flame', name='Daily streak', line='One pick a match day. The longest run of right picks wins.', tag='EPL'),
        dict(href=a('pack=premier-league-2026-27&src=soccer'), icon='q', name="The season's questions", line="The title, the Golden Boot and the bottom club, with the group's chance on every answer. Opens beside pick'em; untick it for questions alone.", tag='EPL'),
    ],
    more='''
      <div class="label klabel">Two all season, two finishing now</div>
      <div class="comps">
        <a class="comp" href="''' + a('comp=epl&src=soccer') + '''"><span class="badge" aria-hidden="true">EPL</span><b>Premier League</b><small>Every matchweek to May</small></a>
        <a class="comp" href="''' + a('comp=mls&src=soccer') + '''"><span class="badge" aria-hidden="true">MLS</span><b>MLS</b><small data-until="2026-11-08T05:00:00Z">Decision Day, 7 November; playoff rounds open as they're set</small><small data-from="2026-11-08T05:00:00Z">The playoffs, each round as it's set</small></a>
        <a class="comp" href="''' + a('comp=wsl&src=soccer') + '''"><span class="badge" aria-hidden="true">WSL</span><b>Women's Super League</b><small>Every matchweek to May</small></a>
        <a class="comp" href="''' + a('comp=nwsl&src=soccer') + '''" data-until="2026-11-22T05:00:00Z"><span class="badge" aria-hidden="true">NWSL</span><b>NWSL</b><small data-until="2026-11-09T05:00:00Z">The quarter-finals, 6 to 8 November; later rounds open as they're set</small><small data-from="2026-11-09T05:00:00Z">Later playoff rounds, each as it's set</small></a>
      </div>''',
    steps_h2='Three steps to kick-off.',
    steps=[
        ('Start it, send one link', 'Pick the competition and the pool, name it and drop the link in the group chat. Friends join with just a name.'),
        ('Call it before kick-off', 'Each call locks at its own kick-off, and a reminder goes out before each matchweek. Bank one match to count it double.'),
        ('It settles itself', 'Results land at full time. The table moves, and every match has its own thread for the chirps.'),
    ],
    demo_h2='Your calls, one matchweek.',
    demo_lead='Exact, result or nothing, scored the moment each match ends, with your banker doubled.',
    demo=SOCCER_DEMO,
    proof_h2='Built by a league.',
    proof=GENERIC_PROOF('kick-off', 'the match ends'),
    faq=[
        (MONEY_Q, 'No. Pools are played for points and a crown. Supercoins are never bought, never sold, never turned into money.'),
        ('How does Call the score work?', 'Three points for the exact score, one for the right result, and the match you bank counts double. Each call locks at its own kick-off.'),
        # MLS and the NWSL have one round each in the feed (MLS Decision Day, the NWSL quarter-finals), and a pick'em fixes its
        # last round when it starts (migration 294), so nothing here says a pool runs to MLS Cup or the final
        ('Which competitions are on?', "The Premier League and the WSL every matchweek to May. MLS and the NWSL are at the end of their seasons: a pool started today plays one round, MLS Decision Day on 7 November or the NWSL quarter-finals on 6 to 8 November, and later playoff rounds open as they're set. The Champions League isn't on yet."),
        ('What happens with a draw?', 'In pick\'em a draw is a pick of its own. In last one standing a draw or a loss puts you out, and a called-off match lets you through.'),
        (APP_Q, APP_A),
        ('Can we start mid-season?', 'Yes. A pool plays from the next matchweek still to come, and each call locks at its own kick-off.'),
    ],
    close_h2='Start yours before kick-off.',
    close_p='A minute to set up, one link for the group chat, and friends join with just a name.',
    close_link=('Every kind of pool', './#kinds'),
    league_note='Not affiliated with any league or club.',
)

PAGES = [HOCKEY, FOOTBALL, BASKETBALL, SOCCER]
