import hh from 'hardhat';
import { assert } from 'chai';
import { ethers } from 'hardhat';
import { register, setBalance } from './test.utils';
import { expect } from 'chai';
import { makeRandomBid } from './integration-test.utils';

describe.only('LiquidationQueue', async () => {
    it('should make a bid with a random premium between 0 and 10%', async () => {
        const { liquidationQueue, deployer, weth, LQ_META, yieldBox } =
            await register();

        const randomPremium = await makeRandomBid(
            liquidationQueue,
            deployer,
            weth,
            LQ_META,
            yieldBox,
        );

        await expect(
            liquidationQueue.bid(
                deployer.address,
                randomPremium,
                LQ_META.minBidAmount,
            ),
        ).to.emit(liquidationQueue, 'Bid');

        expect(
            (await liquidationQueue.bidPools(randomPremium, deployer.address))
                .amount,
        ).to.equal(LQ_META.minBidAmount);
    });

    it('should make multiple bids with random premiums', async () => {
        const accounts = await ethers.getSigners();
        const { liquidationQueue, weth, LQ_META, yieldBox } = await register();
        accounts.forEach(async (account) => {
            const randomPremium = await makeRandomBid(
                liquidationQueue,
                account,
                weth,
                LQ_META,
                yieldBox,
            );

            await expect(
                liquidationQueue.bid(
                    account.address,
                    randomPremium,
                    LQ_META.minBidAmount,
                ),
            ).to.emit(liquidationQueue, 'Bid');

            expect(
                (
                    await liquidationQueue.bidPools(
                        randomPremium,
                        account.address,
                    )
                ).amount,
            ).to.equal(LQ_META.minBidAmount);
        });
    });

    it('should liquidate multiple users and collect fees', async () => {
        const {
            liquidationQueue,
            deployer,
            weth,
            usdc,
            LQ_META,
            wethUsdcOracle,
            multiSwapper,
            yieldBox,
            __wethUsdcPrice,
            feeCollector,
            wethUsdcMixologist,
            BN,
        } = await register();

        const marketAssetId = await wethUsdcMixologist.assetId();
        const marketColId = await wethUsdcMixologist.collateralId();
        const wethAmount = BN(1e18).mul(100);

        const users = [];

        for (let i = 0; i < 1000; i++) {
            const eoa = new ethers.Wallet(
                ethers.Wallet.createRandom().privateKey,
                ethers.provider,
            );

            await setBalance(eoa.address, 100000);
            const randomPremium = await makeRandomBid(
                liquidationQueue,
                deployer,
                weth,
                LQ_META,
                yieldBox,
            );

            await liquidationQueue.bid(
                deployer.address,
                randomPremium,
                LQ_META.minBidAmount.mul(100),
            );

            users.push({ premium: randomPremium, account: eoa });

            await hh.network.provider.send('evm_increaseTime', [10_000]);
            await hh.network.provider.send('evm_mine');
            await liquidationQueue.activateBid(deployer.address, randomPremium);

            await weth.connect(eoa).freeMint(wethAmount);
            await weth.connect(eoa).approve(yieldBox.address, wethAmount);

            await yieldBox
                .connect(eoa)
                .depositAsset(
                    marketAssetId,
                    eoa.address,
                    eoa.address,
                    wethAmount,
                    0,
                );

            await yieldBox
                .connect(eoa)
                .setApprovalForAll(wethUsdcMixologist.address, true);
            await wethUsdcMixologist
                .connect(eoa)
                .addAsset(
                    eoa.address,
                    false,
                    await yieldBox.toShare(marketAssetId, wethAmount, false),
                );
            const usdcAmount = wethAmount.mul(__wethUsdcPrice.div(BN(1e18)));
            const borrowAmount = usdcAmount
                .mul(74)
                .div(100)
                .div(__wethUsdcPrice.div(BN(1e18)));

            await usdc.connect(eoa).freeMint(usdcAmount);
            await usdc.connect(eoa).approve(yieldBox.address, usdcAmount);
            await yieldBox
                .connect(eoa)
                .depositAsset(
                    marketColId,
                    eoa.address,
                    eoa.address,
                    usdcAmount,
                    0,
                );
            await yieldBox.setApprovalForAll(wethUsdcMixologist.address, true);
            await wethUsdcMixologist
                .connect(eoa)
                .addCollateral(
                    eoa.address,
                    false,
                    await yieldBox.toShare(marketColId, usdcAmount, false),
                );
            await wethUsdcMixologist
                .connect(eoa)
                .borrow(eoa.address, borrowAmount);
        }

        const priceDrop = __wethUsdcPrice.mul(5).div(100);

        await wethUsdcOracle.set(__wethUsdcPrice.add(priceDrop));
        await wethUsdcMixologist.updateExchangeRate();

        const userAddresses = users.map((user) => user.account.address);

        await expect(
            wethUsdcMixologist.liquidate(
                userAddresses,
                [await wethUsdcMixologist.userBorrowPart(deployer.address)],
                multiSwapper.address,
            ),
        ).to.not.be.reverted;

        expect(await liquidationQueue.balancesDue(deployer.address)).to.not.eq(
            0,
        );

        await liquidationQueue.redeem(feeCollector.address);

        expect(
            await liquidationQueue.balancesDue(feeCollector.address),
        ).to.not.eq(0);
    });
});
