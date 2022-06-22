import hh from 'hardhat';
import { assert } from 'chai';
import { register } from './test.utils';

describe.only('LiquidationQueue', async () => {
    it('Should execute a bid', async () => {
        await new Promise<void>(async (resolve, reject) => {
            const {
                deployer,
                yieldBox,
                eoa1,
                weth,
                wethUsdcMixologist,
                __wethUsdcPrice,
                wethUsdcOracle,
                liquidationQueue,
                multiSwapper,
                usdc,
                LQ_META,
                BN,
            } = await register();
            await (await weth.freeMint(LQ_META.minBidAmount)).wait();
            await (
                await weth.approve(yieldBox.address, LQ_META.minBidAmount)
            ).wait();

            const POOL = 5;
            const marketAssetId = await wethUsdcMixologist.assetId();
            const marketColId = await wethUsdcMixologist.collateralId();

            await yieldBox.depositAsset(
                await liquidationQueue.lqAssetId(),
                deployer.address,
                deployer.address,
                LQ_META.minBidAmount,
                0,
            );

            await yieldBox.setApprovalForAll(liquidationQueue.address, true);
            liquidationQueue.once('Bid', async () => {
                try {
                    assert(
                        (
                            await liquidationQueue.bidPools(
                                POOL,
                                deployer.address,
                            )
                        ).amount.eq(LQ_META.minBidAmount),
                        'Bid for deployer address is equal to bid amount',
                    );
                } catch (e) {
                    reject(e);
                }
            });

            await liquidationQueue.bid(
                deployer.address,
                POOL,
                LQ_META.minBidAmount,
            );
            // Wait 10min
            await hh.network.provider.send('evm_increaseTime', [10_000]);
            await hh.network.provider.send('evm_mine');

            liquidationQueue.once('ActivateBid', async () => {
                try {
                    assert(
                        (
                            await liquidationQueue.bidPools(
                                POOL,
                                deployer.address,
                            )
                        ).amount.eq(0),
                        'Check that bid pool entry was removed from queue',
                    );
                } catch (e) {
                    reject(e);
                }
            });

            await liquidationQueue.activateBid(deployer.address, POOL);

            const wethAmount = BN(1e18).mul(100);
            await weth.connect(eoa1).freeMint(wethAmount);
            await weth.connect(eoa1).approve(yieldBox.address, wethAmount);

            await yieldBox
                .connect(eoa1)
                .depositAsset(
                    marketAssetId,
                    eoa1.address,
                    eoa1.address,
                    wethAmount,
                    0,
                );
            await yieldBox
                .connect(eoa1)
                .setApprovalForAll(wethUsdcMixologist.address, true);
            await wethUsdcMixologist
                .connect(eoa1)
                .addAsset(
                    eoa1.address,
                    false,
                    await yieldBox.toShare(marketAssetId, wethAmount, false),
                );

            // Mint some usdc to deposit as collateral and borrow with deployer
            const usdcAmount = wethAmount.mul(__wethUsdcPrice.div(BN(1e18)));
            const borrowAmount = usdcAmount
                .mul(74)
                .div(100)
                .div(__wethUsdcPrice.div(BN(1e18)));

            await usdc.freeMint(usdcAmount);
            await usdc.approve(yieldBox.address, usdcAmount);
            await yieldBox.depositAsset(
                marketColId,
                deployer.address,
                deployer.address,
                usdcAmount,
                0,
            );

            await yieldBox.setApprovalForAll(wethUsdcMixologist.address, true);
            await wethUsdcMixologist.addCollateral(
                deployer.address,
                false,
                await yieldBox.toShare(marketColId, usdcAmount, false),
            );
            await wethUsdcMixologist.borrow(deployer.address, borrowAmount);

            // Make some price movement and liquidate
            const priceDrop = __wethUsdcPrice.mul(5).div(100);
            await wethUsdcOracle.set(__wethUsdcPrice.add(priceDrop));
            await wethUsdcMixologist.updateExchangeRate();

            wethUsdcMixologist.once('LogRemoveCollateral', async () => {
                try {
                    assert(
                        (await liquidationQueue.balancesDue(
                            deployer.address,
                        )) !== BN(0),
                        'Check that LQ Balances were added',
                    );
                    resolve();
                } catch (e) {
                    reject(e);
                }
            });

            wethUsdcMixologist.liquidate(
                [deployer.address],
                [await wethUsdcMixologist.userBorrowPart(deployer.address)],
                multiSwapper.address,
            );
        });
    });
});
