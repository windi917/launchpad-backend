const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const solanaWeb3 = require('@solana/web3.js');
const voteService = require('../services/vote.service');

// Establish connection
// https://mainnet.helius-rpc.com/?api-key=f1d5fa66-a4cd-4cb6-a0c3-49c3500e7c0f
let connection = new solanaWeb3.Connection("https://mainnet.helius-rpc.com/?api-key=f1d5fa66-a4cd-4cb6-a0c3-49c3500e7c0f", 'finalized');

const sleep = (time) => {
    return new Promise(resolve => setTimeout(resolve, time))
}

exports.create = async (req, res, next) => {
    if (!req.auth) {
        return res.status(402).json({ "Error": "Invalid Auth" });
    }
    try {
        let startTime = Math.floor(new Date().getTime() / 1000);

        let txHash = req.body.txHash;
        let txsInfo = await connection.getTransaction(txHash, 'confirmed');

        do {
            if ( !txsInfo ) {
                console.log("fetching tx info...")
                await sleep(5000);
                txsInfo = await connection.getTransaction(txHash, "confirmed");
                let endTime = Math.floor(new Date().getTime() / 1000);
                if (endTime - startTime > 60) {
                    console.log("timeout!")
                    break;
                }
            } else {
                break;
            }
        } while (true);

        const result = txsInfo;

        if ( result === null || result === undefined )
            return res.status(402).json({ "Error": "Transaction error" });

        console.log("TX-----: ", result);
        let postBal = result.meta.postTokenBalances.find(e => (req.auth.walletaddress === e.owner));
        let preBal = result.meta.preTokenBalances.find(e => (req.auth.walletaddress === e.owner));

        const votetoken = await prisma.voteToken.findUnique({
            where: { tokenMint: postBal.mint.toString() },
        });
        const token = await prisma.token.findUnique({
            where: { id: req.body.tokenId },
        });
        let voteTokenId = votetoken.id;
        if (token.proposalStatus == "PENDING")
            return res.status(402).json({ "Error": "PENDING STATUS" });
        let periodId = token.periodId;
        const tokenpair = await prisma.voteTokenPair.findMany({
            where: { periodId, voteTokenId },
        });
        {
            let currentAmount = preBal.uiTokenAmount.uiAmount - postBal.uiTokenAmount.uiAmount;
            if (req.body.votePower > tokenpair[0].weight * currentAmount) //Typical amount + 1 should be Vote Power
                res.status(401).json({ error: "Invalid VotePower" });
            else {
                try {
                    const vote = await voteService.createVote({
                        ...req.body,
                        votingUser: req.auth.userId
                    });

                    /// update total vote power of proposal
                    const newToken = await prisma.token.update({
                        where: { id: token.id },
                        data: {
                            currentVotePower: token.currentVotePower + req.body.votePower * tokenpair[0].weight
                        }
                    });

                    res.status(200).json(vote)
                } catch (error) {
                    res.status(402).json(error);
                }
            }
        }
    } catch (error) {
        next(error);
    }
}

exports.createNone = async (req, res, next) => {
    if (!req.auth) {
        return res.status(402).json({ "Error": "Invalid Auth" });
    }
    try {
        const user = await prisma.user.findUnique({
            where: { id: req.auth.userId },
        });

        if (!user) {
            return res.status(404).json({ "Error": "User not found." });
        }

        const tokenId = req.body.tokenId;

        const freeVoteArray = user.freeVote;
        if (freeVoteArray.includes(tokenId))
            return res.status(402).json({ "Error": "Free Vote Limit is only 1." });
        freeVoteArray.push(tokenId)

        const vote = await voteService.createVote({
            ...req.body,
            votingUser: req.auth.userId
        });

        const token = await prisma.token.findUnique({
            where: { id: tokenId },
        });

        if (!token) {
            return res.status(404).json({ "Error": "Token not found." });
        }

        /// update total vote power of proposal
        const newToken = await prisma.token.update({
            where: { id: token.id },
            data: {
                currentVotePower: token.currentVotePower + 1
            }
        });

        const newUser = await prisma.user.update({
            where: { id: req.auth.userId },
            data: {
                freeVote: freeVoteArray
            }
        })

        res.status(200).json(vote)
    } catch (error) {
        res.status(402).json(error);
    }
}