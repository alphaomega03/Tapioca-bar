import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { LiquidationQueue, WETH9Mock, YieldBox } from '../typechain';

export const makeRandomBid = async (
    liquidationQueue: LiquidationQueue,
    deployer: SignerWithAddress,
    weth: WETH9Mock,
    LQ_META: {
        activationTime?: number;
        minBidAmount: any;
        feeCollector?: string;
    },
    yieldBox: YieldBox,
) => {
    const POOL = Math.floor(Math.random() * 10);

    await (await weth.freeMint(LQ_META.minBidAmount.mul(100))).wait();
    await (
        await weth.approve(yieldBox.address, LQ_META.minBidAmount.mul(100))
    ).wait();
    await yieldBox.depositAsset(
        await liquidationQueue.lqAssetId(),
        deployer.address,
        deployer.address,
        LQ_META.minBidAmount.mul(100),
        0,
    );

    await yieldBox.setApprovalForAll(liquidationQueue.address, true);
    return POOL;
};
