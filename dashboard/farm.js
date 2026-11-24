// Token Radar's farm plans. The same derivation main.ts writes to board.json: category, chains,
// TVL and age decide the action, the capital, the hold and every cost and time. No protocol name is
// special-cased. main.ts and this file must agree: the build checks every row's steps against them.
(function () {
  'use strict';

  function chainOf(p) { return p.chains && p.chains.length > 0 ? p.chains[0] : 'its main chain'; }
  function capitalFor(p) {
    if (p.tvl_usd >= 5e9) return 250;
    if (p.tvl_usd >= 1e9) return 150;
    if (p.tvl_usd >= 1e8) return 100;
    return 50;
  }
  function minCapitalFor(p) { return Math.max(10, Math.round(capitalFor(p) / 5 / 5) * 5); }
  function holdDaysFor(age) {
    if (age === null || age === undefined) return 45;
    if (age < 180) return 60;
    if (age < 365) return 45;
    return 30;
  }
  // Gas on the protocol's main chain: Ethereum is the expensive outlier, most chains are cheap.
  function gasFor(chain) {
    if (chain === 'Ethereum') return { setup: 'about $8 of gas', weekly: 'about $4 of gas a week' };
    if (chain === 'Solana' || chain === 'Sui' || chain === 'Aptos' || chain === 'Near' || chain === 'Sei') {
      return { setup: 'under $0.10 of gas', weekly: 'a few cents of gas a week' };
    }
    return { setup: 'under $1 of gas', weekly: 'under $0.50 of gas a week' };
  }
  function actionFor(p, capital, minCapital, chain) {
    var c = (p.category || '').toLowerCase();
    var name = p.name;
    var size = '$' + capital + ' (at least $' + minCapital + ' to count)';
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'Supply ' + size + ' of USDC to ' + name + ' on ' + chain + ' and keep the position open.';
    if (c.indexOf('dex') >= 0 || c.indexOf('yield') >= 0 || c.indexOf('leveraged farm') >= 0 || c.indexOf('liquidity manager') >= 0) return 'Provide ' + size + ' of liquidity to ' + name + "'s main pool on " + chain + ' and keep the position open.';
    if (c.indexOf('bridge') >= 0) return 'Bridge ' + size + ' of USDC to ' + chain + ' through ' + name + ' and use the bridged funds in its app.';
    if (c.indexOf('staking') >= 0 || c.indexOf('restak') >= 0) return 'Stake ' + size + " of the chain's staking asset through " + name + ' and keep the receipt token.';
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0 || c.indexOf('options') >= 0) return 'Deposit ' + size + ' of USDC as margin on ' + name + ' and open one small hedged trade.';
    if (c.indexOf('prediction') >= 0) return 'Fund ' + size + ' and place one market position on ' + name + '.';
    if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0) return 'Deposit ' + size + ' into a ' + name + ' vault on ' + chain + ' and keep the shares.';
    if (c.indexOf('stable') >= 0) return 'Mint or deposit ' + size + ' of the stable asset through ' + name + ' on ' + chain + '.';
    if (c.indexOf('rwa') >= 0) return 'Mint ' + size + " of the protocol's yield asset on " + chain + ' and hold it.';
    if (c.indexOf('insurance') >= 0) return 'Buy ' + size + ' of cover from ' + name + ' on ' + chain + ' and keep the policy.';
    if (c.indexOf('basis') >= 0) return 'Deposit ' + size + " of USDC into " + name + "'s basis vault on " + chain + ' and keep the receipt.';
    return 'Deposit ' + size + ' of USDC into ' + name + ' on ' + chain + ' and keep the position open.';
  }
  function secondActionFor(p) {
    var c = (p.category || '').toLowerCase();
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'Borrow a small amount against the supply, then repay it, so the position shows both sides of the market.';
    if (c.indexOf('dex') >= 0 || c.indexOf('yield') >= 0 || c.indexOf('liquidity manager') >= 0) return 'Make one swap through the pool you provide to, so the wallet shows trading activity as well as liquidity.';
    if (c.indexOf('bridge') >= 0) return 'Bridge a small amount back through the same route, so the wallet shows a round trip rather than a single crossing.';
    if (c.indexOf('staking') >= 0 || c.indexOf('restak') >= 0) return 'Claim or restake the staking rewards once, so the wallet shows ongoing participation.';
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0 || c.indexOf('options') >= 0) return 'Close the hedge and open one more small trade, so the wallet shows repeat use rather than a single deposit.';
    if (c.indexOf('prediction') >= 0) return 'Settle or close the first position and place a second one, so the wallet shows repeat markets.';
    return 'Use the protocol a second way, such as a swap, a vote or a second deposit, so the wallet shows more than one kind of activity.';
  }
  function stepText(step) {
    var s = step.text + ' Cost: ' + step.cost + '. Time: ' + step.time + '.';
    if (s.length > 600) s = s.slice(0, 596) + '...';
    if (s.length < 20) s = s + " Hold the position and check the protocol's own page.";
    return s;
  }
  function farmSteps(p) {
    var chain = chainOf(p);
    var capital = capitalFor(p);
    var minCapital = minCapitalFor(p);
    var hold = holdDaysFor(p.age_days);
    var gas = gasFor(chain);
    return [
      { text: 'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.', cost: 'nothing to set up', time: '5 minutes' },
      { text: actionFor(p, capital, minCapital, chain), cost: '$' + capital + ' of capital and ' + gas.setup, time: '15 minutes to set up' },
      { text: secondActionFor(p), cost: gas.setup, time: '10 minutes' },
      { text: 'Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote, and hold the position for at least ' + hold + ' days so the activity is counted in more than one snapshot.', cost: gas.weekly + '; the $' + capital + ' stays in the position', time: '10 minutes a week for ' + hold + ' days' },
      { text: "Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes; never pay a fee to claim.", cost: 'no fee to check, and never pay to claim', time: '10 minutes' },
      { text: 'Write the wallet, the dates and every transaction in a farm log, and unwind in the reverse order you entered so nothing is left staked.', cost: 'nothing but the log', time: '5 minutes' }
    ].map(stepText);
  }

  window.RADAR_FARM = { farmSteps: farmSteps, capitalFor: capitalFor, minCapitalFor: minCapitalFor, holdDaysFor: holdDaysFor };
})();
