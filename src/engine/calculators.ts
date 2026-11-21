export interface RentalInput {
  monthlyRent: number;
  deposit: number;
  remainingMonths: number;
  penaltyBasis: 'remaining-percent' | 'rent-multiple';
  penaltyPercent: number;
  penaltyMonths: number;
  forfeitDeposit: boolean;
  vacancyMonths: number;
  otherLoss: number;
}

export interface FitnessInput {
  totalPrice: number;
  totalMonths: number;
  usedMonths: number;
  feePercent: number;
}

export interface InternshipInput {
  monthlyPay: number;
  contractFee: number;
  relationship: 'labor' | 'non-labor' | 'unknown';
  specialTraining: boolean;
  trainingCost: number;
  totalServiceMonths: number;
  unservedMonths: number;
}

export const rentalDefaults: RentalInput = {
  monthlyRent: 1800,
  deposit: 1800,
  remainingMonths: 6,
  penaltyBasis: 'remaining-percent',
  penaltyPercent: 100,
  penaltyMonths: 2,
  forfeitDeposit: true,
  vacancyMonths: 1,
  otherLoss: 0,
};

export const fitnessDefaults: FitnessInput = {
  totalPrice: 2880,
  totalMonths: 12,
  usedMonths: 3,
  feePercent: 100,
};

export const internshipDefaults: InternshipInput = {
  monthlyPay: 2640,
  contractFee: 10000,
  relationship: 'unknown',
  specialTraining: false,
  trainingCost: 10000,
  totalServiceMonths: 24,
  unservedMonths: 12,
};

const MAX_AMOUNT = 10_000_000;
const MAX_MONTHS = 120;

/** 非有限输入回到下界；有限输入限制范围，保留小数月份。 */
function clamp(value: number, maximum: number, minimum = 0): number {
  return Number.isFinite(value) ? Math.min(maximum, Math.max(minimum, value)) : minimum;
}

/** 金额节点按分舍入，后续加减使用已展示金额，避免明细与合计相差一分。 */
function roundMoney(value: number): number {
  const cents = value * 100;
  return Math.round(cents + Number.EPSILON * Math.max(1, cents)) / 100;
}

/** 提前退租的输入推演；1.3L 仅为比较阈值，不是法定赔偿上限。 */
export function calculateRental(input: RentalInput): {
  penalty: number;
  depositClaim: number;
  contractClaim: number;
  estimatedLoss: number;
  referenceLow: number;
  referenceHigh: number;
  potentialDifference: number;
} {
  const remainingMonths = clamp(input.remainingMonths, MAX_MONTHS);
  // 只涵盖提前退租；不把其他损坏、欠租等独立责任带入零剩余期限。
  if (remainingMonths === 0) {
    return {
      penalty: 0,
      depositClaim: 0,
      contractClaim: 0,
      estimatedLoss: 0,
      referenceLow: 0,
      referenceHigh: 0,
      potentialDifference: 0,
    };
  }

  const monthlyRent = clamp(input.monthlyRent, MAX_AMOUNT);
  const penalty = roundMoney(input.penaltyBasis === 'rent-multiple'
    ? monthlyRent * clamp(input.penaltyMonths, 24)
    : monthlyRent * remainingMonths * clamp(input.penaltyPercent, 300) / 100);
  const depositClaim = input.forfeitDeposit ? roundMoney(clamp(input.deposit, MAX_AMOUNT)) : 0;
  const contractClaim = roundMoney(penalty + depositClaim);
  const vacancyMonths = Math.min(clamp(input.vacancyMonths, MAX_MONTHS), remainingMonths);
  const estimatedLoss = roundMoney(monthlyRent * vacancyMonths + clamp(input.otherLoss, MAX_AMOUNT));
  const referenceHigh = roundMoney(estimatedLoss * 1.3);

  return {
    penalty,
    depositClaim,
    contractClaim,
    estimatedLoss,
    referenceLow: estimatedLoss,
    referenceHigh,
    potentialDifference: roundMoney(Math.max(0, contractClaim - referenceHigh)),
  };
}

/** 按剩余期限均摊；只计算输入，不判断是否具备依法解除及退款的条件。 */
export function calculateFitness(input: FitnessInput): {
  referenceRefund: number;
  merchantDeduction: number;
  merchantRefund: number;
  difference: number;
  usedMonths: number;
  totalMonths: number;
} {
  const totalPrice = clamp(input.totalPrice, MAX_AMOUNT);
  const totalMonths = clamp(input.totalMonths, MAX_MONTHS, 1);
  const usedMonths = clamp(input.usedMonths, totalMonths);
  const feePercent = clamp(input.feePercent, 100);
  const referenceRefund = roundMoney(totalPrice * ((totalMonths - usedMonths) / totalMonths));
  // 手续费基数是未消费余额，而非购买总价。
  const merchantDeduction = roundMoney(referenceRefund * feePercent / 100);
  const merchantRefund = roundMoney(Math.max(0, referenceRefund - merchantDeduction));

  return {
    referenceRefund,
    merchantDeduction,
    merchantRefund,
    difference: roundMoney(referenceRefund - merchantRefund),
    usedMonths,
    totalMonths,
  };
}

/** 按已输入的关系与专项培训条件推演，不判断竞业、损害赔偿或解除豁免。 */
export function calculateInternship(input: InternshipInput): {
  contractClaim: number;
  referenceCeiling: number | null;
  referencePayment: number | null;
  potentiallyDisputable: number | null;
  monthsOfPay: number | null;
  status: 'ordinary-training' | 'special-training' | 'relationship-uncertain' | 'service-period-uncertain';
} {
  const contractClaim = roundMoney(clamp(input.contractFee, MAX_AMOUNT));
  const monthlyPay = clamp(input.monthlyPay, MAX_AMOUNT);
  const payRatio = monthlyPay > 0 ? contractClaim / monthlyPay : null;
  // 月薪为零或极小正数导致比值溢出时不输出 Infinity；此比值并非金额。
  const monthsOfPay = payRatio !== null && Number.isFinite(payRatio) ? payRatio : null;
  const uncertainAmounts = {
    contractClaim,
    referenceCeiling: null,
    referencePayment: null,
    potentiallyDisputable: null,
    monthsOfPay,
  };

  if (input.relationship !== 'labor') {
    return { ...uncertainAmounts, status: 'relationship-uncertain' };
  }
  if (!input.specialTraining) {
    return {
      contractClaim,
      referenceCeiling: 0,
      referencePayment: 0,
      potentiallyDisputable: contractClaim,
      monthsOfPay,
      status: 'ordinary-training',
    };
  }

  const totalServiceMonths = clamp(input.totalServiceMonths, MAX_MONTHS);
  if (totalServiceMonths === 0) {
    return { ...uncertainAmounts, status: 'service-period-uncertain' };
  }
  const unservedMonths = clamp(input.unservedMonths, totalServiceMonths);
  const trainingCost = clamp(input.trainingCost, MAX_AMOUNT);
  const referenceCeiling = roundMoney(trainingCost * (unservedMonths / totalServiceMonths));

  return {
    contractClaim,
    referenceCeiling,
    referencePayment: Math.min(contractClaim, referenceCeiling),
    potentiallyDisputable: roundMoney(Math.max(0, contractClaim - referenceCeiling)),
    monthsOfPay,
    status: 'special-training',
  };
}

const moneyFormatter = new Intl.NumberFormat('zh-CN', {
  style: 'decimal',
  useGrouping: true,
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

/** 只格式化数字，不加币种符号；结果合计可超过单项输入的金额上限。 */
export function formatMoney(n: number): string {
  return moneyFormatter.format(Number.isFinite(n) ? Math.max(0, n) : 0);
}
