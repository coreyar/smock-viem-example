import {
  time,
  loadFixture,
} from "@nomicfoundation/hardhat-toolbox-viem/network-helpers";
import { expect } from "chai";
import { smock } from '@defi-wonderland/smock';
import hre from "hardhat";
import { getAddress, parseEther } from "viem";

describe("SmockLock", function () {
  // We define a fixture to reuse the same setup in every test.
  // We use loadFixture to run this setup once, snapshot that state,
  // and reset Hardhat Network to that snapshot in every test.
  async function deployOneYearLockFixture() {
    const ONE_YEAR_IN_SECS = 365 * 24 * 60 * 60;

    const lockedAmount = parseEther("1");
    const unlockTime = BigInt((await time.latest()) + ONE_YEAR_IN_SECS);

    // Contracts are deployed using the first signer/account by default
    const [owner, otherAccount] = await hre.viem.getWalletClients();
    const [ownerEthers, otherAccountEthers] = await hre.ethers.getSigners();

    const lockFactory = await smock.mock("Lock");
    const fakeLock = await lockFactory.deploy(unlockTime);

    await hre.network.provider.send('hardhat_setBalance', [
      fakeLock.address,
      '0x0de0b6b3a7640000',
    ]);

    const publicClient = await hre.viem.getPublicClient();

    return {
      fakeLock,
      unlockTime,
      lockedAmount,
      owner,
      otherAccount,
      ownerEthers,
      publicClient,
    };
  }

  describe("Deployment", function () {
    it("Should set the right unlockTime", async function () {
      const { fakeLock, unlockTime } = await loadFixture(deployOneYearLockFixture);

      expect(await fakeLock.unlockTime()).to.equal(unlockTime);
    });

    it("Should set the right owner", async function () {
      const { fakeLock, owner } = await loadFixture(deployOneYearLockFixture);

      expect(await fakeLock.owner()).to.equal(getAddress(owner.account.address));
    });

    it("Should receive and store the funds to lock", async function () {
      const { fakeLock, lockedAmount, publicClient } = await loadFixture(
        deployOneYearLockFixture
      );

      expect(
        await publicClient.getBalance({
          address: fakeLock.address,
        })
      ).to.equal(lockedAmount);
    });

    it("Should fail if the unlockTime is not in the future", async function () {
      // We don't use the fixture here because we want a different deployment
      const latestTime = BigInt(await time.latest());
      await expect(
        hre.viem.deployContract("Lock", [latestTime], {
          value: 1n,
        })
      ).to.be.rejectedWith("Unlock time should be in the future");
    });
  });

  describe("Withdrawals", function () {
    describe("Validations", function () {
      it("Should revert with the right error if called too soon", async function () {
        const { fakeLock, ownerEthers } = await loadFixture(deployOneYearLockFixture);

        await expect(fakeLock.connect(ownerEthers).withdraw()).to.be.rejectedWith(
          "You can't withdraw yet"
        );

      });

      it("Should revert with the right error if called from another account", async function () {
        const { fakeLock, unlockTime, otherAccount } = await loadFixture(
          deployOneYearLockFixture
        );
        // We can increase the time in Hardhat Network
        await time.increaseTo(unlockTime);

        // We retrieve the contract with a different account to send a transaction
        const lockAsOtherAccount = await hre.viem.getContractAt(
          "Lock",
          fakeLock.address,
          { walletClient: otherAccount }
        );

        await expect(lockAsOtherAccount.write.withdraw()).to.be.rejectedWith(
          "You aren't the owner"
        );

      });

      it("Shouldn't fail if the unlockTime has arrived and the owner calls it", async function () {
        const { fakeLock, unlockTime } = await loadFixture(
          deployOneYearLockFixture
        );

        const lockViem = await hre.viem.getContractAt(
          "Lock",
          fakeLock.address,
        );

        // Transactions are sent using the first signer by default
        await time.increaseTo(unlockTime);

        await expect(lockViem.write.withdraw()).to.be.fulfilled;
      });
    });

    describe("Events", function () {
      it("Should emit an event on withdrawals", async function () {
        const { fakeLock, unlockTime, lockedAmount, publicClient } =
          await loadFixture(deployOneYearLockFixture);

        const lockViem = await hre.viem.getContractAt(
          "Lock",
          fakeLock.address,
        );

        await time.increaseTo(unlockTime);

        const hash = await lockViem.write.withdraw();
        await publicClient.waitForTransactionReceipt({ hash });

        // get the withdrawal events in the latest block
        const withdrawalEvents = await lockViem.getEvents.Withdrawal()
        expect(withdrawalEvents).to.have.lengthOf(1);
        expect(withdrawalEvents[0].args.amount).to.equal(lockedAmount);
      });
    });
  });

  describe("Smock With Viem", function () {
    it("Should revert with the right error if called from another account", async function () {
      const { fakeLock, unlockTime, otherAccount, ownerEthers } = await loadFixture(
        deployOneYearLockFixture
      );
      let lockViem = await hre.viem.getContractAt(
        "Lock",
        fakeLock.address,
      );
      // Sanity check that withdraw reverts normally
      await expect(lockViem.simulate.withdraw()).to.be.rejectedWith(
        "You can't withdraw yet"
      );

      // Lock should always revert with you aren't owner
      fakeLock.withdraw.reverts("You aren't the owner")

      // Withdraw now revers with you aren't the owner
      await expect(lockViem.simulate.withdraw()).to.be.rejectedWith(
        "You aren't the owner"
      );

      // We are not the owner
      lockViem = await hre.viem.getContractAt(
        "Lock",
        fakeLock.address,
        { walletClient: otherAccount }
      );

      await expect(lockViem.write.withdraw()).to.be.rejectedWith(
        "You aren't the owner"
      );

      // We are the owner
      lockViem = await hre.viem.getContractAt(
        "Lock",
        fakeLock.address,
      );

      await expect(lockViem.write.withdraw()).to.be.rejectedWith(
        "You aren't the owner"
      );

      // Reset mock
      fakeLock.withdraw.reset()

      // Sanity check that reverts normally
      await expect(lockViem.simulate.withdraw()).to.be.rejectedWith(
        "You can't withdraw yet"
      );

      // We can increase the time in Hardhat Network
      await time.increaseTo(unlockTime);

      await lockViem.write.withdraw()

    });
  })
});
