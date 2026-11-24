# The event pages' words (24 November 2026): the three windows the growth review named, each a page a person searching
# for that pool lands on, written through the sport pages' template (gen_sports.py).
#
# Every start button names the event itself (#/new?comp=nfl-post-2026&kind=bracket). The start page decides what that
# opens from what is live that minute: the event once its field is set, and until then the league as it stands, with a
# line saying when the playoff pool opens (src/lib/comingEvents.ts). So no button here depends on a guessed hour.
#
# Dates. The NFL: wild card weekend 16 to 18 January 2027 (the first kickoff Saturday 4:30 pm ET), the divisional round
# 23 and 24 January, the conference championships 31 January, Super Bowl LXI on Sunday 14 February, 6:30 pm ET, SoFi
# Stadium (fbschedules.com, read 24 November 2026). The regular season ends Sunday 10 January. The NHL's regular season
# ends 10 April 2027; the playoff field is set that night and the first round starts in the days after.
import html
from sports_content import a, MONEY_Q, APP_Q, APP_A

FIELD = '2027-01-11T05:00:00Z'       # the NFL field is set (the night of Sunday 10 January, Eastern)
WILD = '2027-01-16T21:30:00Z'        # the first wild card kickoff: the bracket locks
SB = '2027-02-14T23:30:00Z'          # Super Bowl LXI kicks off
CUP_FIELD = '2027-04-11T04:00:00Z'   # the NHL's last regular-season night is over
CUP_END = '2027-06-25T04:00:00Z'     # by when a Cup final is over

NFL_PROOF = [
    ('target', '<b>Scored from public score feeds.</b> Every pick locks at its own kickoff and settles as the game goes final, overtime included.'),
    ('users', "<b>The pool's split shows after each lock, never before,</b> so nobody copies the room."),
    ('shield', '<b>A result the feed gets wrong,</b> your host can set for the pool alone, with the reason on the record.'),
]

# ---------------------------------------------------------------- the NFL playoffs
BRACKET_DEMO = '''        <figure class="scr bk rv" aria-label="A sample playoff bracket entry">
          <span class="sample-cap">Sample pool</span>
          <div class="scr-head"><b>Your bracket</b><small>13 games</small></div>
          <div class="sub2"><span>The Office Pool · the bracket</span><span><b>9</b> points · 2nd of 11</span></div>
          <div class="bk-rounds">
            <div class="bk-r"><span class="bk-h">Wild card <i>1 pt</i></span>
              <span class="bk-t y">BUF</span><span class="bk-t y">BAL</span><span class="bk-t n">LAC</span><span class="bk-t y">DET</span><span class="bk-t y">PHI</span><span class="bk-t n">GB</span></div>
            <div class="bk-r"><span class="bk-h">Divisional <i>2 pts</i></span>
              <span class="bk-t y">KC</span><span class="bk-t y">BUF</span><span class="bk-t o">DET</span><span class="bk-t w">PHI</span></div>
            <div class="bk-r"><span class="bk-h">Conference <i>4 pts</i></span>
              <span class="bk-t w">BUF</span><span class="bk-t w">DET</span></div>
            <div class="bk-r fin"><span class="bk-h">Super Bowl <i>8 pts</i></span>
              <span class="bk-t w me">BUF</span></div>
          </div>
          <div class="bk-tab">
            <div class="bx-row"><span class="rk">1</span><span>Hail Marys</span><span class="tot">10</span><span class="mv">22 still to win</span></div>
            <div class="bx-row me"><span class="rk">2</span><b>Your bracket</b><span class="tot">9</span><span class="mv">24 still to win</span></div>
            <div class="bx-row"><span class="rk">3</span><span>Fourth and Long</span><span class="tot">8</span><span class="mv">12 still to win</span></div>
          </div>
          <div class="pk-foot"><span>Tiebreaker · the Super Bowl's total points</span><b>Your call: 47</b></div>
          <figcaption>Sample pool · names and results made up</figcaption>
        </figure>'''

NFL_Q = 'comp=nfl-post-2026&kind=%s&src=nfl-playoffs'
NFL_PLAYOFFS = dict(
    slug='nfl-playoff-pools', og_image='og-nfl-playoffs.png',
    og_alt='Super Pools: the NFL playoff pool that scores itself. A sample bracket, wild card weekend to the Super Bowl.', src='nfl-playoffs', sport='nfl', ghosts=1,
    title="NFL Playoff Pool: Bracket, Pick'em and Squares, Free | Super Pools",
    desc="A free NFL playoff pool for your office or group chat: the bracket, a pick on every playoff game, the Eliminator, prop sheets and Super Bowl squares. It scores itself. Never money.",
    og_title='The NFL playoff pool that scores itself',
    og_desc='The bracket, a pick on every playoff game, prop sheets and Super Bowl squares. One link for the group chat. Never money.',
    eyebrow='NFL playoffs · wild card weekend 16 January · Super Bowl LXI 14 February',
    h1='The playoff pool <span class="l2"><em>that scores itself.</em></span>',
    sub='The bracket, a pick on every playoff game, prop sheets and Super Bowl squares, in one pool with its own chat.',
    ctas=[
        dict(q=NFL_Q % 'bracket', label='Start a playoff pool', attrs={'data-until': SB}),
        dict(q='src=nfl-playoffs', label='Start a pool', attrs={'data-from': SB}),
    ],
    demo_link='See a bracket',
    deadline=(
        f'<span data-until="{FIELD}"><b>The field is set Sunday 10 January.</b> Start now, and the bracket joins your pool in a tap that night</span>'
        f'<span data-from="{FIELD}" data-until="{WILD}"><b>The bracket is open.</b> It locks at the first wild card kickoff, Saturday 16 January, 4:30&nbsp;pm&nbsp;ET</span>'
        f'<span data-from="{WILD}" data-until="{SB}"><b>The playoffs are on.</b> A pick on every game left, and a grid on the Super Bowl, Sunday 14 February</span>'
        f'<span data-from="{SB}"><b>Super Bowl LXI has kicked off.</b> Playoff pools open again next January</span>'),
    proof_icon='check',
    proofline="Settled from the scores: every pick locks at kickoff, the table moves as games end, and the pool's split shows after the lock, never before.",
    now_tag='From the app', now_p='The NFL as it stands, with the next kickoff counting down.',
    kinds_h2='Six ways to play the playoffs.',
    kinds_lead=(
        f'<span data-until="{FIELD}">Tap one and name your pool. Until the field is set on 10 January the start page opens on the NFL as it stands and says so; the playoff pool is one tap to add the night it opens, same pool, same crew.</span>'
        f'<span data-from="{FIELD}">Tap one and the start page opens on it. Run two or three in the same pool: they share one table and one chat.</span>'),
    kinds=[
        dict(href=a(NFL_Q % 'bracket'), icon='bracket', name='The bracket', line='All 13 games, wild card weekend to the Super Bowl, picked before the first kickoff. Each round is worth double the last.', tag='Locks 16 Jan',
             attrs={'data-until': WILD}),
        dict(href=a(NFL_Q % 'series'), icon='check', name='Pick every game', line='The winner of each playoff game, round by round. Later rounds open as their matchups are set, so a late joiner still plays.', tag='Each round'),
        dict(href=a(NFL_Q % 'survivor'), icon='shield', name='The Eliminator', line='One team to win each round, never the same one twice. A loss and you are out.', tag='Each round'),
        dict(href=a(NFL_Q % 'props'), icon='sheet', name='The prop sheet', line='Eight calls on one game: the winner, the total, the margin, who leads at the half. A point each, settled from the score.', tag='Any game'),
        dict(href=a('comp=nfl-post-2026&kind=squares&src=nfl-playoffs'), icon='grid', name='Super Bowl squares', line='The 10 by 10 grid, or 5 by 5 for a small group, paid every quarter in Supercoins.', tag='14 Feb'),
        dict(href=a(NFL_Q % 'sweep'), icon='hat', name='The sweepstake', line='Everyone is dealt playoff teams from the hat. Nothing to pick: hold the champion and you win it.', tag='Pure luck',
             attrs={'data-until': WILD}),
        dict(href=a('pack=nfl-2026&src=nfl-playoffs'), icon='q', name='Who wins Super Bowl LXI?', line="Open today: the Super Bowl, both conferences and the awards, with the group's chance on every answer.", tag='Open now',
             attrs={'data-until': '2027-01-09T17:00:00Z'}),
    ],
    more='''
      <p class="kl-more"><span>Only here for the grid? Super Bowl squares has a page of its own.</span><a class="textlink" href="./super-bowl-squares.html">Super Bowl squares</a></p>''',
    steps_h2='Three steps to wild card weekend.',
    steps=[
        ('Start it, send one link', 'Pick the pool, name it and drop the link in the office chat. It unfurls as an invite, and people join with just a name, in the browser.'),
        ('Pick before kickoff', 'The bracket locks at the first wild card kickoff. Every other pick locks at its own game, and a reminder goes out before each round.'),
        ('It settles itself', 'Results land as each game goes final. The table moves, the chat hears about it, and nobody keeps a spreadsheet.'),
    ],
    demo_h2='Your bracket, round by round.',
    demo_lead='Every pick marks itself as games end, and the table shows what each bracket can still win, so a broken one knows if it can climb.',
    demo=BRACKET_DEMO,
    proof_h2='Built by a league.',
    proof=NFL_PROOF,
    faq=[
        ('Is it free, and is there any money in it?', 'It is free, and there is no money in it. Pools are played for points and a crown. Supercoins are never bought, never sold and never turned into money. If your office collects a few dollars a head, that stays between you.'),
        ('When can I start an NFL playoff pool?', 'Today. The 14-team field is set on Sunday 10 January 2027 and the bracket opens that night. A pool started earlier plays the NFL as it stands, and its host adds the bracket in one tap when it opens, so the crew is already in when it matters.'),
        ('When does the bracket lock?', 'At the first wild card kickoff, Saturday 16 January 2027 at 4:30 pm Eastern. Every other playoff pick locks at its own kickoff.'),
        ('How is the bracket scored?', 'A point for each wild card winner, two in the divisional round, four for a conference champion and eight for the Super Bowl. Flat scoring, a point a game, is the other choice. Ties go to the closest call on the Super Bowl\'s total points.'),
        ('What if someone joins after wild card weekend?', "They can't fill in a bracket, but a pool can run more than one game: pick every game, the Eliminator and the prop sheets all take a late joiner from the next round."),
        (APP_Q, APP_A),
        ('Can we run Super Bowl squares in the same pool?', 'Yes. Add the grid from the pool\'s Host page, under Add a game, once the field is set. It shares the pool\'s members and chat. <a href="./super-bowl-squares.html">How the squares work.</a>'),
    ],
    close_h2='Get the crew in before wild card weekend.',
    close_p='A minute to set up, one link for the group chat, and friends join with just a name.',
    close_link=('Every NFL pool', './football-pools.html'),
    league_note='Not affiliated with the NFL or any team. Super Bowl is a trademark of the NFL.',
)

# ---------------------------------------------------------------- Super Bowl squares
def _grid():
    top = [3, 7, 0, 4, 1, 8, 6, 9, 2, 5]
    side = [0, 3, 7, 4, 1, 6, 9, 2, 8, 5]
    names = ['Ana', 'Raj', 'Sam', 'Mei', 'Tom', 'Zoe', 'Lou', 'Ife', 'You', 'Kai', 'Dev', 'Bea']
    cells = ['<span class="sq-c sq-x"></span>'] + [f'<span class="sq-c sq-d">{d}</span>' for d in top]
    for r, d in enumerate(side):
        cells.append(f'<span class="sq-c sq-d">{d}</span>')
        for c in range(10):
            n = names[(r * 7 + c * 5 + r * c) % len(names)]
            cls = ' me' if n == 'You' else ''
            # the square the half-time score names: the top side's 7 and the left side's 3
            if top[c] == 7 and d == 3: cls += ' hit'
            cells.append(f'<span class="sq-c{cls}">{n if (r + c) % 9 else ""}</span>')
    return ''.join(cells)

SQUARES_DEMO = f'''        <figure class="scr sq rv" aria-label="A sample Super Bowl squares grid">
          <span class="sample-cap">Sample pool</span>
          <div class="scr-head"><b>The grid</b><span class="live">Live</span></div>
          <div class="sub2"><span>The Office Pool · 10 by 10 · 10 a square</span><span><b>94</b> of 100 claimed</span></div>
          <div class="sq-ax"><span>NFC champion across</span><span>AFC champion down</span></div>
          <div class="sq-grid" aria-hidden="true">{_grid()}</div>
          <ol class="sq-pays">
            <li><span>After the 1st quarter · 7-3</span><b>Mei, 188</b></li>
            <li class="now"><span>At the half · 17-13</span><b>Raj, 188</b></li>
            <li><span>After the 3rd quarter</span><i>to come</i></li>
            <li><span>The final score</span><i>376 to come</i></li>
          </ol>
          <figcaption>Sample pool · names and scores made up · Supercoins, never money</figcaption>
        </figure>'''

SB_Q = 'comp=nfl-post-2026&kind=squares&src=super-bowl'
SUPER_BOWL = dict(
    slug='super-bowl-squares', og_image='og-super-bowl-squares.png',
    og_alt='Super Pools: Super Bowl squares, run for you. A sample 10 by 10 grid with the half-time square lit.', src='super-bowl', sport='nfl', ghosts=1,
    title='Super Bowl Squares Online, Free for Your Group | Super Pools',
    desc='Run Super Bowl squares online, free: a 10 by 10 or 5 by 5 grid your group fills from one link, digits drawn fairly, every quarter scored by itself. Supercoins, never money.',
    og_title='Super Bowl squares, run for you',
    og_desc='One link for the group chat. The grid fills, the digits are drawn fairly, and every quarter pays itself. Never money.',
    eyebrow='Super Bowl LXI · Sunday 14 February 2027 · 6:30 pm ET',
    h1='Super Bowl squares, <span class="l2"><em>run for you.</em></span>',
    sub='One link for the group chat. The grid fills, the digits are drawn from a seed anyone can check, and every quarter pays itself.',
    ctas=[
        dict(q=SB_Q, label='Start a squares grid', attrs={'data-until': SB}),
        dict(q='src=super-bowl', label='Start a pool', attrs={'data-from': SB}),
    ],
    demo_link='See a grid',
    deadline=(
        f'<span data-until="{FIELD}"><b>The Super Bowl grid opens Sunday 10 January,</b> once the playoff field is set. Until then, try a grid on any game this week</span>'
        f'<span data-from="{FIELD}" data-until="{SB}"><b>The Super Bowl grid is open.</b> Squares close at kickoff, Sunday 14 February, 6:30&nbsp;pm&nbsp;ET</span>'
        f'<span data-from="{SB}"><b>Super Bowl LXI has kicked off.</b> A grid goes on any NFL game from next September</span>'),
    proof_icon='grid',
    proofline='No spreadsheet, no screenshot of a poster board: claims, the draw and every winning square are on the record in the pool.',
    now_tag='From the app', now_p='The NFL as it stands. A grid can go on any game still to come.',
    kinds_h2='One grid, or a whole Super Bowl party.',
    kinds_lead='A pool can run more than one game on the same night. They share its members, its table and its chat.',
    kinds=[
        dict(href=a(SB_Q), icon='grid', name='The 10 by 10', line='The classic: 100 squares, one digit a side. Made for an office or a big family.', tag='Classic'),
        dict(href=a(SB_Q), icon='grid', name='The 5 by 5', line='25 squares with two digits a side, so a group of six can fill it. Pick the size on the start page.', tag='Small group'),
        dict(href=a('comp=nfl-post-2026&kind=props&src=super-bowl'), icon='sheet', name='The prop sheet', line='Eight calls on the game: the winner, the total, the margin, who leads at the half. A point each.', tag='Same night'),
        dict(href=a('comp=nfl-post-2026&kind=bracket&src=super-bowl'), icon='bracket', name='The playoff bracket', line='Every game from wild card weekend, picked before the first kickoff on 16 January.', tag='Locks 16 Jan',
             attrs={'data-until': WILD}),
    ],
    more='''
      <p class="kl-more"><span>Want the whole postseason? The bracket, a pick on every game and the Eliminator are on the playoff page.</span><a class="textlink" href="./nfl-playoff-pools.html">NFL playoff pools</a></p>''',
    steps_h2='Three steps to kickoff.',
    steps=[
        ('Start it, send one link', 'Pick 10 by 10 or 5 by 5, what a square costs in Supercoins and how many each person can hold. Drop the link in the chat; people join with just a name.'),
        ('The grid fills, the digits are drawn', 'Everyone claims squares, or lets the grid pick for them. The digits 0 to 9 are drawn for each team when the grid is full or at kickoff, from a recorded seed anyone can check.'),
        ('Every quarter pays itself', 'The last digit of each score names the square after the 1st quarter, at the half, after the 3rd and on the final. The chat hears who won before the commercial ends.'),
    ],
    demo_h2='The grid, as the game plays.',
    demo_lead='Your squares are marked, the winning square lights at each checkpoint, and its Supercoins land by themselves: 20 per cent a quarter and 40 on the final, or the final score alone.',
    demo_fine='\n          <p class="fine">An empty winning square passes its Supercoins to the next claimed square along the row.</p>',
    demo=SQUARES_DEMO,
    proof_h2='Built by a league.',
    proof=[
        ('grid', '<b>The draw is on the record.</b> The digits are shuffled from a seed kept with the grid, so anyone in the pool can check the order.'),
        ('target', '<b>Paid from the score by quarter,</b> from public score feeds, the moment each checkpoint lands.'),
        ('shield', '<b>A square can be handed back</b> for a refund until the digits are drawn, and a score the feed gets wrong is your host\'s to set, with the reason on the record.'),
    ],
    faq=[
        ('How do Super Bowl squares work?', 'A grid has one team across the top and the other down the side. Everyone claims squares, then the digits 0 to 9 are drawn for each side. At the end of each quarter, the last digit of each team\'s score names the winning square: at 17-13, the square where 7 meets 3.'),
        ('Is it free, and is there any money in it?', 'It is free, and there is no money in it. Squares are claimed with Supercoins, which everyone in the pool is given and which are never bought, sold or turned into money. If your group collects a few dollars a square, that stays between you.'),
        ('When are the numbers drawn?', 'The moment the grid is full, or at kickoff if it isn\'t. Nobody knows their digits when they claim, and the draw comes from a recorded seed anyone can check afterwards.'),
        ('What if the grid does not fill?', 'It plays as it is. When the score names an empty square, its Supercoins pass to the next claimed square along the row. For a small group the 5 by 5, 25 squares with two digits a side, fills fast.'),
        ('How does it pay?', 'After the 1st quarter, at the half, after the 3rd quarter and on the final score: 20, 20, 20 and 40 per cent of the Supercoins paid in. Or choose the final score alone. Overtime counts toward the final.'),
        ('When can I set it up?', 'The Super Bowl grid opens the night the playoff field is set, Sunday 10 January 2027, before the teams are known. Before that, a grid goes on any NFL game of the week, which is a good way to try it with the same crew.'),
        (APP_Q, APP_A),
    ],
    close_h2='Fill the grid before kickoff.',
    close_p='A minute to set up, one link for the group chat, and friends join with just a name.',
    close_link=('NFL playoff pools', './nfl-playoff-pools.html'),
    league_note='Not affiliated with the NFL or any team. Super Bowl is a trademark of the NFL.',
)

# ---------------------------------------------------------------- the Stanley Cup playoffs
CUP_DEMO = '''        <figure class="scr bx rv" aria-label="A sample playoff box pool entry">
          <span class="sample-cap">Sample pool</span>
          <div class="scr-head"><b>Your entry</b><span class="live">Live</span></div>
          <div class="sub2"><span>The Rink Pool · playoff box pool</span><span>Round 1 <b>+9</b></span></div>
          <ol class="bx-list">
            <li><span class="bx-n"><small>Box</small><b>1</b></span><div class="bx-p">MacKinnon <span>COL · leads 3-1 · 4G 5A</span></div><span class="bx-pts">9</span><span class="bx-o">Forwards · also McDavid, Kucherov, Matthews, Draisaitl</span></li>
            <li class="now"><span class="bx-n"><small>Box</small><b>2</b></span><div class="bx-p">Kaprizov <span>MIN · 2nd, 8:14 · 2G 3A</span></div><span class="bx-pts">5</span><span class="bx-o">Forwards · also Pastrnak, Rantanen, Eichel, Point</span></li>
            <li class="out"><span class="bx-n"><small>Box</small><b>3</b></span><div class="bx-p">Batherson <span>OTT · out in 5 · 1G 2A</span></div><span class="bx-pts z">3</span><span class="bx-o">Forwards · also Hischier, Tkachuk, Zibanejad, Larkin</span></li>
            <li><span class="bx-n"><small>Box</small><b>4</b></span><div class="bx-p">Makar <span>COL · leads 3-1 · 1G 4A</span></div><span class="bx-pts">5</span><span class="bx-o">Defence · also Hughes, Werenski, Fox, Hedman</span></li>
            <li><span class="bx-n"><small>Box</small><b>5</b></span><div class="bx-p">Hellebuyck <span>WPG · tied 2-2 · 2W</span></div><span class="bx-pts">4</span><span class="bx-o">Goalies · also Shesterkin, Vasilevskiy, Sorokin, Oettinger</span></li>
          </ol>
          <div class="bx-tab">
            <div class="label"><span>The table</span><span>31 entries</span></div>
            <div class="bx-row"><span class="rk">1</span><span>Five Hole Heroes</span><span class="tot">29</span><span class="mv">5 of 5 alive</span></div>
            <div class="bx-row me"><span class="rk">2</span><b>Your entry</b><span class="tot">26</span><span class="mv">4 of 5 alive</span></div>
            <div class="bx-row"><span class="rk">3</span><span>Zamboni Drivers</span><span class="tot">24</span><span class="mv">3 of 5 alive</span></div>
          </div>
          <p class="bx-rule">Goal 1 · Assist 1 · Goalie win 2 · Shutout 1 · counted to the last game of the Cup final</p>
          <figcaption>Sample pool · names and results made up</figcaption>
        </figure>'''

CUP_Q = 'comp=nhl-post-2027&kind=%s&src=cup-playoffs'
CUP = dict(
    slug='stanley-cup-playoff-pools', og_image='og-cup-playoffs.png',
    og_alt='Super Pools: the Stanley Cup playoff pool, counted live. A sample playoff box pool entry.', src='cup-playoffs', sport='nhl', ghosts=2,
    title='Stanley Cup Playoff Pool: Box Pool and Bracket, Free | Super Pools',
    desc='A free Stanley Cup playoff pool for your office or group chat: the playoff box pool, the bracket, pick the series, prop sheets and squares by period. Points count themselves, live. Never money.',
    og_title='The playoff pool, counted live',
    og_desc='The playoff box pool, the bracket and pick the series, scored from the NHL box scores as every goal goes in. Never money.',
    eyebrow='Stanley Cup playoffs 2027 · round 1 in mid-April',
    h1='The playoff pool, <span class="l2"><em>counted live.</em></span>',
    sub='The playoff box pool, the bracket and pick the series, with every goal, assist and goalie win counted as it happens.',
    ctas=[
        dict(q=CUP_Q % 'players', label='Start a playoff pool', attrs={'data-until': CUP_END}),
        dict(q='src=cup-playoffs', label='Start a pool', attrs={'data-from': CUP_END}),
    ],
    demo_link='See an entry',
    deadline=(
        f'<span data-until="{CUP_FIELD}"><b>The field is set Saturday 10 April.</b> Start a box pool on the season now, and add the playoff pool in a tap that night</span>'
        f'<span data-from="{CUP_FIELD}" data-until="2027-04-20T04:00:00Z"><b>The playoff pools are open.</b> Entries and brackets lock at the first puck drop of round 1</span>'
        f'<span data-from="2027-04-20T04:00:00Z" data-until="{CUP_END}"><b>The playoffs are on.</b> Pick the series opens each round as its matchups are set</span>'
        f'<span data-from="{CUP_END}"><b>The Cup has been won.</b> Playoff pools open again next April</span>'),
    proof_icon='box',
    proofline="Points move with every goal from the NHL's box scores, the feed that scores the SaK Superleague each night.",
    now_tag='From the app', now_p="Hockey as it stands, straight from the app, with the next puck drop counting down.",
    kinds_h2='Five ways to play the playoffs.',
    kinds_lead=(
        f'<span data-until="{CUP_FIELD}">Tap one and name your pool. Until the field is set on 10 April the start page opens on the regular season\'s box pool and says so; the playoff pool is one tap to add the night it opens, same pool, same crew.</span>'
        f'<span data-from="{CUP_FIELD}">Tap one and the start page opens on it. Run two or three in the same pool: they share one table and one chat.</span>'),
    kinds=[
        dict(href=a(CUP_Q % 'players'), icon='box', name='The playoff box pool', line='One player from each box, dealt on the games each is expected to play. Goals, assists and goalie wins count to the last night of the final.', tag='Before round 1'),
        dict(href=a(CUP_Q % 'bracket'), icon='bracket', name='The bracket', line='All 15 series picked before the first puck drop, each round worth double the last, with a point for calling how many games.', tag='Before round 1'),
        dict(href=a(CUP_Q % 'series'), icon='series', name='Pick the series', line='Call each series and how many games it goes, round by round. Later rounds open as their matchups are set, so a late joiner still plays.', tag='Each round'),
        dict(href=a(CUP_Q % 'props'), icon='sheet', name='The prop sheet', line='Eight calls on one playoff game, a point each, settled from the score by period.', tag='Any game'),
        dict(href=a(CUP_Q % 'squares'), icon='grid', name='Squares by period', line='A grid on a series, paid after the 1st and 2nd periods and the final of every game.', tag='Any series'),
        dict(href=a(CUP_Q % 'sweep'), icon='hat', name='The sweepstake', line='Everyone is dealt playoff clubs from the hat. Nothing to pick: hold the Cup winner and you win it.', tag='Pure luck'),
    ],
    cal_label='Open tonight',
    cal=[
        dict(attrs={'data-until': CUP_FIELD}, href=a('comp=nhl-2026&kind=players&src=cup-playoffs'), icon='box', name='The box pool, on the season', line='The same game on the regular season: a week, four weeks or the rest of the way. Get the crew in now, and the playoff pool is one tap in April.', tag='NHL'),
        dict(attrs={'data-until': '2027-04-10T16:00:00Z'}, href=a('pack=nhl-2026-27&src=cup-playoffs'), icon='q', name='Who wins the Cup?', line="The Cup, the Presidents' Trophy and the scoring races, with the group's chance on every answer.", tag='Open now'),
    ],
    more='''
      <p class="kl-more"><span>Keeper league? Keepers, the draft room with a clock and a league voice live on the fantasy side.</span><a class="textlink" href="./fantasy-hockey.html">Bring your keeper league</a></p>''',
    steps_h2='Three steps to round 1.',
    steps=[
        ('Start it, send one link', 'Pick the pool, name it and drop the link in the group chat. Poolies join with just a name, in the browser, and any number can play.'),
        ('Pick before the first puck drop', 'One player from every box, or the whole bracket, before round 1 starts. Pick the series stays open round by round.'),
        ('It counts itself', 'Goals, assists, goalie wins and shutouts land live from the box scores, every finished game is re-checked, and the table moves all spring.'),
    ],
    demo_h2='One entry, alive all spring.',
    demo_lead='Your players, what each has scored and whose club is still playing. Take stars from a team that goes deep and the points keep coming.',
    demo=CUP_DEMO,
    proof_h2='Built by a league.',
    proof=[
        ('stick', "<b>Scored from the NHL's own box scores,</b> the feed that has scored the founding league every night this season."),
        ('clock', '<b>Every finished game is re-checked</b> for three days, so a changed assist changes the table.'),
        ('shield', "<b>The bracket and the series picks</b> settle from the NHL's bracket, and your host can set a result for the pool alone, with the reason on the record."),
    ],
    faq=[
        ('Is it free, and is there any money in it?', 'It is free, and there is no money in it. Entries play for points and a crown, and Supercoins are never bought, never sold and never turned into money. If your pool collects dues, that stays between friends.'),
        ('How does a playoff box pool work?', 'The top playoff players are dealt into evenly matched boxes: forwards, then defence, then goalies. Each poolie takes one from every box before round 1. A goal or an assist is a point, a goalie win two and a shutout one, counted to the last game of the Cup final. The host can change the points before the deadline.'),
        ('When can I start one?', 'The playoff pools open the night the field is set, Saturday 10 April 2027, and lock at the first puck drop of round 1. A box pool on the regular season can start tonight, and its host adds the playoff pool in one tap in April, with the crew already in.'),
        ('Can two poolies take the same player?', 'Yes. Boxes are not a draft, so the same player can be on every entry and any number of poolies can play. No draft night needed.'),
        ('How is the bracket scored?', 'One point for each first-round series, two in the second round, four in the conference finals and eight for the Cup, plus a point for calling how many games a series goes. Flat scoring is the other choice.'),
        ('What if someone joins after round 1 starts?', 'The box pool and the bracket are locked by then, but pick the series opens fresh each round, and prop sheets and squares go on any game or series still to come.'),
        (APP_Q, APP_A),
    ],
    close_h2='Get the crew in before round 1.',
    close_p='A minute to set up, one link for the group chat, and poolies join with just a name.',
    close_link=('Every hockey pool', './hockey-pools.html'),
    league_note='Not affiliated with the NHL or any club. Stanley Cup is a trademark of the NHL.',
)

EVENT_PAGES = [NFL_PLAYOFFS, SUPER_BOWL, CUP]
