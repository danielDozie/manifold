import { Dictionary, last, partition, sum, sumBy, uniq } from 'lodash'
import { calculatePayout, getContractBetMetrics } from './calculate'
import { Bet, LimitBet } from './bet'
import {
  Contract,
  CPMMBinaryContract,
  CPMMContract,
  DPMContract,
} from './contract'
import { PortfolioMetrics, User } from './user'
import { DAY_MS } from './util/time'
import { getBinaryCpmmBetInfo, getNewMultiBetInfo } from './new-bet'
import { getCpmmProbability } from './calculate-cpmm'
import { removeUndefinedProps } from './util/object'

const computeInvestmentValue = (
  bets: Bet[],
  contractsDict: { [k: string]: Contract }
) => {
  return sumBy(bets, (bet) => {
    const contract = contractsDict[bet.contractId]
    if (!contract || contract.isResolved) return 0
    if (bet.sale || bet.isSold) return 0

    const payout = calculatePayout(contract, bet, 'MKT')
    const value = payout - (bet.loanAmount ?? 0)
    if (isNaN(value)) return 0
    return value
  })
}

export const computeInvestmentValueCustomProb = (
  bets: Bet[],
  contract: Contract,
  p: number
) => {
  return sumBy(bets, (bet) => {
    if (!contract) return 0
    if (bet.sale || bet.isSold) return 0
    const { outcome, shares } = bet

    const betP = outcome === 'YES' ? p : 1 - p

    const value = betP * shares
    if (isNaN(value)) return 0
    return value
  })
}

export const computeElasticity = (
  unfilledBets: LimitBet[],
  contract: Contract,
  betAmount = 50
) => {
  switch (contract.mechanism) {
    case 'cpmm-1':
      return computeBinaryCpmmElasticity(unfilledBets, contract, betAmount)
    case 'dpm-2':
      return computeDpmElasticity(contract, betAmount)
    default: // there are some contracts on the dev DB with crazy mechanisms
      return 0
  }
}

export const computeBinaryCpmmElasticity = (
  unfilledBets: LimitBet[],
  contract: CPMMContract,
  betAmount: number
) => {
  const sortedBets = unfilledBets.sort((a, b) => a.createdTime - b.createdTime)

  const userIds = uniq(unfilledBets.map((b) => b.userId))
  // Assume all limit orders are good.
  const userBalances = Object.fromEntries(
    userIds.map((id) => [id, Number.MAX_SAFE_INTEGER])
  )

  const { newPool: poolY, newP: pY } = getBinaryCpmmBetInfo(
    'YES',
    betAmount,
    contract,
    undefined,
    sortedBets,
    userBalances
  )
  const resultYes = getCpmmProbability(poolY, pY)

  const { newPool: poolN, newP: pN } = getBinaryCpmmBetInfo(
    'NO',
    betAmount,
    contract,
    undefined,
    sortedBets,
    userBalances
  )
  const resultNo = getCpmmProbability(poolN, pN)

  // handle AMM overflow
  const safeYes = Number.isFinite(resultYes) ? resultYes : 1
  const safeNo = Number.isFinite(resultNo) ? resultNo : 0

  return safeYes - safeNo
}

export const computeBinaryCpmmElasticityFromAnte = (
  ante: number,
  betAmount = 50
) => {
  const pool = { YES: ante, NO: ante }
  const p = 0.5
  const contract = { pool, p } as any

  const { newPool: poolY, newP: pY } = getBinaryCpmmBetInfo(
    'YES',
    betAmount,
    contract,
    undefined,
    [],
    {}
  )
  const resultYes = getCpmmProbability(poolY, pY)

  const { newPool: poolN, newP: pN } = getBinaryCpmmBetInfo(
    'NO',
    betAmount,
    contract,
    undefined,
    [],
    {}
  )
  const resultNo = getCpmmProbability(poolN, pN)

  // handle AMM overflow
  const safeYes = Number.isFinite(resultYes) ? resultYes : 1
  const safeNo = Number.isFinite(resultNo) ? resultNo : 0

  return safeYes - safeNo
}

export const computeDpmElasticity = (
  contract: DPMContract,
  betAmount: number
) => {
  return getNewMultiBetInfo('', 2 * betAmount, contract).newBet.probAfter
}

const computeTotalPool = (userContracts: Contract[], startTime = 0) => {
  const periodFilteredContracts = userContracts.filter(
    (contract) => contract.createdTime >= startTime
  )
  return sum(
    periodFilteredContracts.map((contract) => sum(Object.values(contract.pool)))
  )
}

export const computeVolume = (contractBets: Bet[], since: number) => {
  return sumBy(contractBets, (b) =>
    b.createdTime > since && !b.isRedemption && !b.isAnte
      ? Math.abs(b.amount)
      : 0
  )
}

export const calculateProbChange = (
  prob: number,
  descendingBets: Bet[],
  since: number
) => {
  const newestBet = descendingBets[0]
  if (!newestBet) return 0

  const betBeforeSince = descendingBets.find((b) => b.createdTime < since)

  if (!betBeforeSince) {
    const oldestBet = last(descendingBets) ?? newestBet
    return prob - oldestBet.probBefore
  }

  return prob - betBeforeSince.probAfter
}

export const calculateCreatorVolume = (userContracts: Contract[]) => {
  const allTimeCreatorVolume = computeTotalPool(userContracts, 0)
  const monthlyCreatorVolume = computeTotalPool(
    userContracts,
    Date.now() - 30 * DAY_MS
  )
  const weeklyCreatorVolume = computeTotalPool(
    userContracts,
    Date.now() - 7 * DAY_MS
  )

  const dailyCreatorVolume = computeTotalPool(
    userContracts,
    Date.now() - 1 * DAY_MS
  )

  return {
    daily: dailyCreatorVolume,
    weekly: weeklyCreatorVolume,
    monthly: monthlyCreatorVolume,
    allTime: allTimeCreatorVolume,
  }
}

export const calculateCreatorTraders = (userContracts: Contract[]) => {
  let allTimeCreatorTraders = 0
  let dailyCreatorTraders = 0
  let weeklyCreatorTraders = 0
  let monthlyCreatorTraders = 0

  userContracts.forEach((contract) => {
    allTimeCreatorTraders += contract.uniqueBettorCount ?? 0
    dailyCreatorTraders += contract.uniqueBettors24Hours ?? 0
    weeklyCreatorTraders += contract.uniqueBettors7Days ?? 0
    monthlyCreatorTraders += contract.uniqueBettors30Days ?? 0
  })

  return {
    daily: dailyCreatorTraders,
    weekly: weeklyCreatorTraders,
    monthly: monthlyCreatorTraders,
    allTime: allTimeCreatorTraders,
  }
}

export const calculateNewPortfolioMetrics = (
  user: User,
  contractsById: { [k: string]: Contract },
  currentBets: Bet[]
) => {
  const investmentValue = computeInvestmentValue(currentBets, contractsById)
  const newPortfolio = {
    investmentValue: investmentValue,
    balance: user.balance,
    totalDeposits: user.totalDeposits,
    timestamp: Date.now(),
    userId: user.id,
  }
  return newPortfolio
}

const calculateProfitForPeriod = (
  startingPortfolio: PortfolioMetrics | undefined,
  currentProfit: number
) => {
  if (startingPortfolio === undefined) {
    return currentProfit
  }

  const startingProfit = calculatePortfolioProfit(startingPortfolio)

  return currentProfit - startingProfit
}

export const calculatePortfolioProfit = (portfolio: PortfolioMetrics) => {
  return portfolio.investmentValue + portfolio.balance - portfolio.totalDeposits
}

export const calculateNewProfit = (
  portfolioHistory: Record<
    'current' | 'day' | 'week' | 'month',
    PortfolioMetrics | undefined
  >,
  newPortfolio: PortfolioMetrics
) => {
  const allTimeProfit = calculatePortfolioProfit(newPortfolio)

  const newProfit = {
    daily: calculateProfitForPeriod(portfolioHistory.day, allTimeProfit),
    weekly: calculateProfitForPeriod(portfolioHistory.week, allTimeProfit),
    monthly: calculateProfitForPeriod(portfolioHistory.month, allTimeProfit),
    allTime: allTimeProfit,
  }

  return newProfit
}

export const calculateMetricsByContract = (
  betsByContractId: Dictionary<Bet[]>,
  contractsById: Dictionary<Contract>
) => {
  return Object.entries(betsByContractId).map(([contractId, bets]) => {
    const contract = contractsById[contractId]
    const current = getContractBetMetrics(contract, bets)

    let periodMetrics
    if (contract.mechanism === 'cpmm-1' && contract.outcomeType === 'BINARY') {
      const periods = ['day', 'week', 'month'] as const
      periodMetrics = Object.fromEntries(
        periods.map((period) => [
          period,
          calculatePeriodProfit(contract, bets, period),
        ])
      )
    }

    return removeUndefinedProps({ contractId, ...current, from: periodMetrics })
  })
}

export type ContractMetrics = ReturnType<
  typeof calculateMetricsByContract
>[number]

const calculatePeriodProfit = (
  contract: CPMMBinaryContract,
  bets: Bet[],
  period: 'day' | 'week' | 'month'
) => {
  const days = period === 'day' ? 1 : period === 'week' ? 7 : 30
  const fromTime = Date.now() - days * DAY_MS
  const [previousBets, recentBets] = partition(
    bets,
    (b) => b.createdTime < fromTime
  )

  const { prob, probChanges } = contract
  const prevProb = prob - probChanges[period]

  const previousBetsValue = computeInvestmentValueCustomProb(
    previousBets,
    contract,
    prevProb
  )
  const currentBetsValue = computeInvestmentValueCustomProb(
    previousBets,
    contract,
    prob
  )

  const { profit: recentProfit, invested: recentInvested } =
    getContractBetMetrics(contract, recentBets)

  const profit = currentBetsValue - previousBetsValue + recentProfit
  const invested = previousBetsValue + recentInvested
  const profitPercent = invested === 0 ? 0 : 100 * (profit / invested)

  return {
    profit,
    profitPercent,
    invested,
    prevValue: previousBetsValue,
    value: currentBetsValue,
  }
}
