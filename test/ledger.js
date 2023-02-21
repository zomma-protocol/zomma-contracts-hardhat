const assert = require('assert');
const { getContractFactories, toDecimalStr, strFromDecimal } = require('./support/helper');

let Ledger, accounts;
describe('Ledger', () => {
  let ledger;
  let account;

  before(async () => {
    [Ledger] = await getContractFactories('TestLedger');
    accounts = await ethers.getSigners();
    ledger = await Ledger.deploy();
  });

  describe('#internalUpdatePosition', () => {
    const expiry = 1674201600; // 2023-01-20T08:00:00Z
    const strike = toDecimalStr(1100);

    context('when one call position', () => {

      before(async () => {
        account = accounts[1].address;
        await ledger.updatePosition(account, expiry, strike, true, toDecimalStr(1), toDecimalStr(-10), toDecimalStr(2), 0);
      });

      it('should have one expiry', async () => {
        const expiries = await ledger.listOfExpiries(account);
        assert.deepEqual(expiries.map((e) => e.toNumber()), [expiry]);
      });

      it('should have one strike', async () => {
        const strikes = await ledger.listOfStrikes(account, expiry);
        assert.deepEqual(strikes.map((s) => strFromDecimal(s)), ['1100']);
      });

      it('should have call position', async () => {
        const position = await ledger.positionOf(account, expiry, strike, true);
        assert.equal(strFromDecimal(position.size), '1');
        assert.equal(strFromDecimal(position.notional), '-10');
      });

      it('should have not put position', async () => {
        const position = await ledger.positionOf(account, expiry, strike, false);
        assert.equal(position.size, 0);
        assert.equal(position.notional, 0);
      });

      it('should have call position size 1', async () => {
        assert.equal(strFromDecimal(await ledger.positionSizeOf(account, expiry, strike, true)), '1');
      });

      it('should have put position size 0', async () => {
        assert.equal(strFromDecimal(await ledger.positionSizeOf(account, expiry, strike, false)), '0');
      });

      it('should get fee 2', async () => {
        assert.equal(strFromDecimal(await ledger.balanceOf(account)), '2');
      });
    });

    context('when one call and one put position', () => {
      // const account = accounts[2].address;

      before(async () => {
        account = accounts[2].address;
        await ledger.updatePosition(account, expiry, strike, true, toDecimalStr(1), toDecimalStr(-10), toDecimalStr(2), 0);
        await ledger.updatePosition(account, expiry, strike, false, toDecimalStr(2), toDecimalStr(-20), toDecimalStr(0), 0);
      });

      it('should have one expiry', async () => {
        const expiries = await ledger.listOfExpiries(account);
        assert.deepEqual(expiries.map((e) => e.toNumber()), [expiry]);
      });

      it('should have one strike', async () => {
        const strikes = await ledger.listOfStrikes(account, expiry);
        assert.deepEqual(strikes.map((s) => strFromDecimal(s)), ['1100']);
      });

      it('should have call position', async () => {
        const position = await ledger.positionOf(account, expiry, strike, true);
        assert.equal(strFromDecimal(position.size), '1');
        assert.equal(strFromDecimal(position.notional), '-10');
      });

      it('should have put position', async () => {
        const position = await ledger.positionOf(account, expiry, strike, false);
        assert.equal(strFromDecimal(position.size), '2');
        assert.equal(strFromDecimal(position.notional), '-20');
      });

      it('should have call position size 1', async () => {
        assert.equal(strFromDecimal(await ledger.positionSizeOf(account, expiry, strike, true)), '1');
      });

      it('should have put position size 2', async () => {
        assert.equal(strFromDecimal(await ledger.positionSizeOf(account, expiry, strike, false)), '2');
      });

      it('should get fee 2', async () => {
        assert.equal(strFromDecimal(await ledger.balanceOf(account)), '2');
      });
    });

    context('when three positions in different strikes', () => {
      const strike2 = toDecimalStr(1200);

      before(async () => {
        account = accounts[3].address;
        await ledger.updatePosition(account, expiry, strike, true, toDecimalStr(1), toDecimalStr(-10), toDecimalStr(2), 0);
        await ledger.updatePosition(account, expiry, strike, false, toDecimalStr(2), toDecimalStr(-20), toDecimalStr(0), 0);
        await ledger.updatePosition(account, expiry, strike2, true, toDecimalStr(-3), toDecimalStr(30), toDecimalStr(3), 0);
      });

      it('should have one expiry', async () => {
        const expiries = await ledger.listOfExpiries(account);
        assert.deepEqual(expiries.map((e) => e.toNumber()), [expiry]);
      });

      it('should have two strikes', async () => {
        const strikes = await ledger.listOfStrikes(account, expiry);
        assert.deepEqual(strikes.map((s) => strFromDecimal(s)), ['1100', '1200']);
      });

      it('should have call position', async () => {
        let position = await ledger.positionOf(account, expiry, strike, true);
        assert.equal(strFromDecimal(position.size), '1');
        assert.equal(strFromDecimal(position.notional), '-10');

        position = await ledger.positionOf(account, expiry, strike2, true);
        assert.equal(strFromDecimal(position.size), '-3');
        assert.equal(strFromDecimal(position.notional), '30');
      });

      it('should have put position', async () => {
        const position = await ledger.positionOf(account, expiry, strike, false);
        assert.equal(strFromDecimal(position.size), '2');
        assert.equal(strFromDecimal(position.notional), '-20');
      });

      it('should have call position size 1 and -3', async () => {
        assert.equal(strFromDecimal(await ledger.positionSizeOf(account, expiry, strike, true)), '1');
        assert.equal(strFromDecimal(await ledger.positionSizeOf(account, expiry, strike2, true)), '-3');
      });

      it('should have put position size 2', async () => {
        assert.equal(strFromDecimal(await ledger.positionSizeOf(account, expiry, strike, false)), '2');
      });

      it('should get fee 5', async () => {
        assert.equal(strFromDecimal(await ledger.balanceOf(account)), '5');
      });
    });

    context('when four positions in different expiries', () => {
      const expiry2 = expiry + 86400;
      const strike2 = toDecimalStr(1200);

      before(async () => {
        account = accounts[4].address;
        await ledger.updatePosition(account, expiry, strike, true, toDecimalStr(1), toDecimalStr(-10), toDecimalStr(2), 0);
        await ledger.updatePosition(account, expiry, strike, false, toDecimalStr(2), toDecimalStr(-20), toDecimalStr(0), 0);
        await ledger.updatePosition(account, expiry, strike2, true, toDecimalStr(-3), toDecimalStr(30), toDecimalStr(3), 0);
        await ledger.updatePosition(account, expiry2, strike, true, toDecimalStr(-4), toDecimalStr(40), toDecimalStr(4), 0);
      });

      it('should have two expiries', async () => {
        const expiries = await ledger.listOfExpiries(account);
        assert.deepEqual(expiries.map((e) => e.toNumber()), [expiry, expiry2]);
      });

      it('should have two strike and one strike', async () => {
        let strikes = await ledger.listOfStrikes(account, expiry);
        assert.deepEqual(strikes.map((s) => strFromDecimal(s)), ['1100', '1200']);

        strikes = await ledger.listOfStrikes(account, expiry2);
        assert.deepEqual(strikes.map((s) => strFromDecimal(s)), ['1100']);
      });

      it('should have call position', async () => {
        let position = await ledger.positionOf(account, expiry, strike, true);
        assert.equal(strFromDecimal(position.size), '1');
        assert.equal(strFromDecimal(position.notional), '-10');

        position = await ledger.positionOf(account, expiry, strike2, true);
        assert.equal(strFromDecimal(position.size), '-3');
        assert.equal(strFromDecimal(position.notional), '30');

        position = await ledger.positionOf(account, expiry2, strike, true);
        assert.equal(strFromDecimal(position.size), '-4');
        assert.equal(strFromDecimal(position.notional), '40');
      });

      it('should have put position', async () => {
        const position = await ledger.positionOf(account, expiry, strike, false);
        assert.equal(strFromDecimal(position.size), '2');
        assert.equal(strFromDecimal(position.notional), '-20');
      });

      it('should have call position size 1, -3 and -4', async () => {
        assert.equal(strFromDecimal(await ledger.positionSizeOf(account, expiry, strike, true)), '1');
        assert.equal(strFromDecimal(await ledger.positionSizeOf(account, expiry, strike2, true)), '-3');
        assert.equal(strFromDecimal(await ledger.positionSizeOf(account, expiry2, strike, true)), '-4');
      });

      it('should have put position size 2', async () => {
        assert.equal(strFromDecimal(await ledger.positionSizeOf(account, expiry, strike, false)), '2');
      });

      it('should get fee 9', async () => {
        assert.equal(strFromDecimal(await ledger.balanceOf(account)), '9');
      });
    });

    context('when remove all position', () => {
      const expiry2 = expiry + 86400;
      const strike2 = toDecimalStr(1200);

      before(async () => {
        account = accounts[5].address;
        await ledger.updatePosition(account, expiry, strike, true, toDecimalStr(1), toDecimalStr(-10), toDecimalStr(2), 0);
        await ledger.updatePosition(account, expiry, strike, false, toDecimalStr(2), toDecimalStr(-20), toDecimalStr(0), 0);
        await ledger.updatePosition(account, expiry, strike2, true, toDecimalStr(-3), toDecimalStr(30), toDecimalStr(3), 0);
        await ledger.updatePosition(account, expiry2, strike, true, toDecimalStr(-4), toDecimalStr(40), toDecimalStr(4), 0);

        await ledger.updatePosition(account, expiry, strike, true, toDecimalStr(-1), toDecimalStr(10), toDecimalStr(2), 0);
        await ledger.updatePosition(account, expiry, strike, false, toDecimalStr(-2), toDecimalStr(20), toDecimalStr(0), 0);
        await ledger.updatePosition(account, expiry, strike2, true, toDecimalStr(3), toDecimalStr(-30), toDecimalStr(3), 0);
        await ledger.updatePosition(account, expiry2, strike, true, toDecimalStr(4), toDecimalStr(-40), toDecimalStr(4), 0);
      });

      it('should have no expiries', async () => {
        assert.equal((await ledger.listOfExpiries(account)).length, 0);
      });

      it('should have no strike', async () => {
        assert.equal((await ledger.listOfStrikes(account, expiry)).length, 0);
        assert.equal((await ledger.listOfStrikes(account, expiry2)).length, 0);
      });

      it('should have no call position', async () => {
        let position = await ledger.positionOf(account, expiry, strike, true);
        assert.equal(strFromDecimal(position.size), '0');
        assert.equal(strFromDecimal(position.notional), '0');

        position = await ledger.positionOf(account, expiry, strike2, true);
        assert.equal(strFromDecimal(position.size), '0');
        assert.equal(strFromDecimal(position.notional), '0');

        position = await ledger.positionOf(account, expiry2, strike, true);
        assert.equal(strFromDecimal(position.size), '0');
        assert.equal(strFromDecimal(position.notional), '0');
      });

      it('should have no put position', async () => {
        const position = await ledger.positionOf(account, expiry, strike, false);
        assert.equal(strFromDecimal(position.size), '0');
        assert.equal(strFromDecimal(position.notional), '0');
      });

      it('should have no call position size', async () => {
        assert.equal(strFromDecimal(await ledger.positionSizeOf(account, expiry, strike, true)), '0');
        assert.equal(strFromDecimal(await ledger.positionSizeOf(account, expiry, strike2, true)), '0');
        assert.equal(strFromDecimal(await ledger.positionSizeOf(account, expiry2, strike, true)), '0');
      });

      it('should have no put position size', async () => {
        assert.equal(strFromDecimal(await ledger.positionSizeOf(account, expiry, strike, false)), '0');
      });
    });

    context('when position size 1.000000000000000001', () => {
      let s = 1000;
      const setup = async (size, notional) => {
        const strike = toDecimalStr(s);
        s += 100;
        await ledger.updatePosition(account, expiry, strike, true, toDecimalStr('1.000000000000000001'), toDecimalStr('-10.000000000000000001'), toDecimalStr(0), 0);
        const balanceBefore = await ledger.balanceOf(account);
        await ledger.updatePosition(account, expiry, strike, true, toDecimalStr(size), toDecimalStr(notional), toDecimalStr(0), 0);
        const balanceAfter = await ledger.balanceOf(account);
        const balanceChange = balanceAfter.sub(balanceBefore)
        return { strike, balanceChange };
      };

      before(async () => {
        account = accounts[6].address;
      });

      context('when buy size 0.3', () => {
        let strike, balanceChange;

        before(async () => {
          ({ strike, balanceChange } = await setup(0.3, '-3.000000000000000001'));
        });

        it('should be size 1.300000000000000001', async () => {
          let position = await ledger.positionOf(account, expiry, strike, true);
          assert.equal(strFromDecimal(position.size), '1.300000000000000001');
          assert.equal(strFromDecimal(position.notional), -13);
        });

        it('should not change', async () => {
          assert.equal(strFromDecimal(balanceChange), '0');
        });
      });

      context('when sell size 0.3', () => {
        let strike, balanceChange;

        before(async () => {
          ({ strike, balanceChange } = await setup(-0.3, '2.900000000000000001'));
        });

        it('should be size 0.700000000000000001', async () => {
          let position = await ledger.positionOf(account, expiry, strike, true);
          assert.equal(strFromDecimal(position.size), '0.700000000000000001');
          assert.equal(strFromDecimal(position.notional), '-7.000000000000000004');
        });

        it('should realized -0.099999999999999996', async () => {
          assert.equal(strFromDecimal(balanceChange), '-0.099999999999999996');
        });
      });

      context('when sell size 1.000000000000000001', () => {
        let strike, balanceChange;

        before(async () => {
          ({ strike, balanceChange } = await setup('-1.000000000000000001', '9.900000000000000002'));
        });

        it('should be size 0', async () => {
          let position = await ledger.positionOf(account, expiry, strike, true);
          assert.equal(strFromDecimal(position.size), '0');
          assert.equal(strFromDecimal(position.notional), '0');
        });

        it('should realized -0.099999999999999999', async () => {
          assert.equal(strFromDecimal(balanceChange), '-0.099999999999999999');
        });
      });

      context('when sell size 1.300000000000000002', () => {
        let strike, balanceChange;

        before(async () => {
          ({ strike, balanceChange } = await setup('-1.300000000000000002', '12.800000000000000002'));
        });

        it('should be size -0.300000000000000001', async () => {
          let position = await ledger.positionOf(account, expiry, strike, true);
          assert.equal(strFromDecimal(position.size), '-0.300000000000000001');
          assert.equal(strFromDecimal(position.notional), '2.953846153846153853');
        });

        it('should realized -0.153846153846153852', async () => {
          assert.equal(strFromDecimal(balanceChange), '-0.153846153846153852');
        });
      });
    });

    context('when position size -1.000000000000000001', () => {
      let s = 1000;
      const setup = async (size, notional) => {
        const strike = toDecimalStr(s);
        s += 100;
        await ledger.updatePosition(account, expiry, strike, true, toDecimalStr('-1.000000000000000001'), toDecimalStr('10.000000000000000001'), toDecimalStr(0), 0);
        const balanceBefore = await ledger.balanceOf(account);
        await ledger.updatePosition(account, expiry, strike, true, toDecimalStr(size), toDecimalStr(notional), toDecimalStr(0), 0);
        const balanceAfter = await ledger.balanceOf(account);
        const balanceChange = balanceAfter.sub(balanceBefore)
        return { strike, balanceChange };
      };

      before(async () => {
        account = accounts[7].address;
      });

      context('when sell size 0.3', () => {
        let strike, balanceChange;

        before(async () => {
          ({ strike, balanceChange } = await setup(-0.3, '3.000000000000000001'));
        });

        it('should be size -1.300000000000000001', async () => {
          let position = await ledger.positionOf(account, expiry, strike, true);
          assert.equal(strFromDecimal(position.size), '-1.300000000000000001');
          assert.equal(strFromDecimal(position.notional), 13);
        });

        it('should not change', async () => {
          assert.equal(strFromDecimal(balanceChange), '0');
        });
      });

      context('when buy size 0.3', () => {
        let strike, balanceChange;

        before(async () => {
          ({ strike, balanceChange } = await setup(0.3, '-2.900000000000000001'));
        });

        it('should be size -0.700000000000000001', async () => {
          let position = await ledger.positionOf(account, expiry, strike, true);
          assert.equal(strFromDecimal(position.size), '-0.700000000000000001');
          assert.equal(strFromDecimal(position.notional), '7.000000000000000004');
        });

        it('should realized 0.099999999999999996', async () => {
          assert.equal(strFromDecimal(balanceChange), '0.099999999999999996');
        });
      });

      context('when buy size 1.000000000000000001', () => {
        let strike, balanceChange;

        before(async () => {
          ({ strike, balanceChange } = await setup('1.000000000000000001', '-9.900000000000000002'));
        });

        it('should be size 0', async () => {
          let position = await ledger.positionOf(account, expiry, strike, true);
          assert.equal(strFromDecimal(position.size), '0');
          assert.equal(strFromDecimal(position.notional), '0');
        });

        it('should realized 0.099999999999999999', async () => {
          assert.equal(strFromDecimal(balanceChange), '0.099999999999999999');
        });
      });

      context('when buy size 1.300000000000000002', () => {
        let strike, balanceChange;

        before(async () => {
          ({ strike, balanceChange } = await setup('1.300000000000000002', '-12.800000000000000002'));
        });

        it('should be size 0.300000000000000001', async () => {
          let position = await ledger.positionOf(account, expiry, strike, true);
          assert.equal(strFromDecimal(position.size), '0.300000000000000001');
          assert.equal(strFromDecimal(position.notional), '-2.953846153846153853');
        });

        it('should realized 0.153846153846153852', async () => {
          assert.equal(strFromDecimal(balanceChange), '0.153846153846153852');
        });
      });
    });
  });

  describe('#internalClearPosition', () => {
    const expiry = 1674201600; // 2023-01-20T08:00:00Z
    const strike = toDecimalStr(1100);

    before(async () => {
      account = accounts[8].address;
    });

    context('when position size 0', () => {
      before(async () => {
        await ledger.clearPosition(account, expiry, strike, true, toDecimalStr(1), toDecimalStr(1), 3);
      });

      it('should be empty', async () => {
        let position = await ledger.positionOf(account, expiry, strike, true);
        assert.equal(strFromDecimal(position.size), '0');
        assert.equal(strFromDecimal(position.notional), '0');
      });
    });

    context('when position size 1', () => {
      before(async () => {
        await ledger.updatePosition(account, expiry, strike, true, toDecimalStr(1), toDecimalStr(-10), toDecimalStr(0), 0);
        await ledger.clearPosition(account, expiry, strike, true, toDecimalStr(1), toDecimalStr(1), 3);
      });

      it('should be empty', async () => {
        let position = await ledger.positionOf(account, expiry, strike, true);
        assert.equal(strFromDecimal(position.size), '0');
        assert.equal(strFromDecimal(position.notional), '0');
      });
    });
  });
});
