import { describe, expect, it } from 'vitest';
import {
  calculateFitness,
  calculateInternship,
  calculateRental,
  fitnessDefaults,
  formatMoney,
  internshipDefaults,
  rentalDefaults,
  type FitnessInput,
  type InternshipInput,
  type RentalInput,
} from './calculators';

const rental = (overrides: Partial<RentalInput> = {}) => calculateRental({ ...rentalDefaults, ...overrides });
const fitness = (overrides: Partial<FitnessInput> = {}) => calculateFitness({ ...fitnessDefaults, ...overrides });
const internship = (overrides: Partial<InternshipInput> = {}) => calculateInternship({ ...internshipDefaults, ...overrides });
const invalidNumbers = [-1, -Number.MAX_VALUE, NaN, Infinity, -Infinity];

const defaultRentalResult = {
  penalty: 10800,
  depositClaim: 1800,
  contractClaim: 12600,
  estimatedLoss: 1800,
  referenceLow: 1800,
  referenceHigh: 2340,
  potentialDifference: 10260,
};
const zeroRentalResult = {
  penalty: 0,
  depositClaim: 0,
  contractClaim: 0,
  estimatedLoss: 0,
  referenceLow: 0,
  referenceHigh: 0,
  potentialDifference: 0,
};
const zeroFitnessAmounts = {
  referenceRefund: 0,
  merchantDeduction: 0,
  merchantRefund: 0,
  difference: 0,
};
const uncertainReferences = {
  referenceCeiling: null,
  referencePayment: null,
  potentiallyDisputable: null,
};

function expectSafeResult(result: object): void {
  for (const [key, value] of Object.entries(result)) {
    if (typeof value !== 'number') continue;
    expect(Number.isFinite(value), key).toBe(true);
    expect(value, key).toBeGreaterThanOrEqual(0);
    expect(Object.is(value, -0), key).toBe(false);
    if (!['usedMonths', 'totalMonths', 'monthsOfPay'].includes(key)) {
      expect(value, key).toBe(Number(value.toFixed(2)));
    }
  }
}

describe('教学默认参数', () => {
  it('完整导出指定默认值，实习关系不预设为劳动关系', () => {
    expect(rentalDefaults).toEqual({
      monthlyRent: 1800, deposit: 1800, remainingMonths: 6,
      penaltyBasis: 'remaining-percent', penaltyPercent: 100, penaltyMonths: 2,
      forfeitDeposit: true, vacancyMonths: 1, otherLoss: 0,
    });
    expect(fitnessDefaults).toEqual({ totalPrice: 2880, totalMonths: 12, usedMonths: 3, feePercent: 100 });
    expect(internshipDefaults).toEqual({
      monthlyPay: 2640, contractFee: 10000, relationship: 'unknown', specialTraining: false,
      trainingCost: 10000, totalServiceMonths: 24, unservedMonths: 12,
    });
  });
});

describe('租房提前退租', () => {
  it('默认剩余租金违约金与另行没收押金分别计入合同主张', () => {
    expect(rental()).toEqual(defaultRentalResult);
  });

  it('切换月租倍数后不再使用剩余租金百分比', () => {
    expect(rental({ penaltyBasis: 'rent-multiple', penaltyPercent: 300 })).toEqual({
      penalty: 3600, depositClaim: 1800, contractClaim: 5400,
      estimatedLoss: 1800, referenceLow: 1800, referenceHigh: 2340, potentialDifference: 3060,
    });
  });

  it('未另行没收押金时不重复计入同一责任', () => {
    expect(rental({ forfeitDeposit: false })).toEqual({
      ...defaultRentalResult, depositClaim: 0, contractClaim: 10800, potentialDifference: 8460,
    });
  });

  it('空置损失加可核实其他损失，1.3 倍只作比较阈值', () => {
    expect(rental({ vacancyMonths: 2, otherLoss: 300 })).toEqual({
      penalty: 10800, depositClaim: 1800, contractClaim: 12600,
      estimatedLoss: 3900, referenceLow: 3900, referenceHigh: 5070, potentialDifference: 7530,
    });
  });

  it('空置期不能超过实际剩余租期', () => {
    expect(rental({ remainingMonths: 2, vacancyMonths: 9 })).toEqual({
      penalty: 3600, depositClaim: 1800, contractClaim: 5400,
      estimatedLoss: 3600, referenceLow: 3600, referenceHigh: 4680, potentialDifference: 720,
    });
  });

  it.each(['remaining-percent', 'rent-multiple'] as const)('剩余租期为零时 %s 模型全部归零', (penaltyBasis) => {
    expect(rental({ remainingMonths: 0, otherLoss: 9999, penaltyBasis })).toEqual(zeroRentalResult);
  });

  it('损失未输入不等于合同主张被归零', () => {
    expect(rental({ vacancyMonths: 0 })).toEqual({
      ...defaultRentalResult, estimatedLoss: 0, referenceLow: 0, referenceHigh: 0, potentialDifference: 12600,
    });
  });

  it('月租为零仍展示独立输入的押金与其他损失', () => {
    expect(rental({ monthlyRent: 0, otherLoss: 100 })).toEqual({
      penalty: 0, depositClaim: 1800, contractClaim: 1800,
      estimatedLoss: 100, referenceLow: 100, referenceHigh: 130, potentialDifference: 1670,
    });
  });

  it('合同主张低于比较阈值时差额不为负', () => {
    expect(rental({ penaltyPercent: 0, forfeitDeposit: false })).toEqual({
      ...defaultRentalResult, penalty: 0, depositClaim: 0, contractClaim: 0, potentialDifference: 0,
    });
  });

  it('保留小数月份、费率和金额，按分展示结果', () => {
    expect(rental({
      monthlyRent: 1234.56, deposit: 800.01, remainingMonths: 2.5,
      penaltyPercent: 50, vacancyMonths: 0.75, otherLoss: 99.99,
    })).toEqual({
      penalty: 1543.2, depositClaim: 800.01, contractClaim: 2343.21,
      estimatedLoss: 1025.91, referenceLow: 1025.91, referenceHigh: 1333.68, potentialDifference: 1009.53,
    });
  });

  it('月租倍数支持小数，不截成整数', () => {
    expect(rental({ penaltyBasis: 'rent-multiple', penaltyMonths: 1.25 })).toEqual({
      ...defaultRentalResult, penalty: 2250, contractClaim: 4050, potentialDifference: 1710,
    });
  });

  it('正确舍入半分与浮点误差，并让展示差额与展示金额一致', () => {
    expect(rental({
      monthlyRent: 10.075, deposit: 1.005, remainingMonths: 1, vacancyMonths: 0, otherLoss: 2.05,
    })).toEqual({
      penalty: 10.08, depositClaim: 1.01, contractClaim: 11.09,
      estimatedLoss: 2.05, referenceLow: 2.05, referenceHigh: 2.67, potentialDifference: 8.42,
    });
  });

  it.each([[0, 0], [100, 10800], [300, 32400], [301, 32400]])(
    '剩余租金百分比 %s 对应违约金 %s，限制在 0..300', (penaltyPercent, penalty) => {
      expect(rental({ penaltyPercent, penaltyMonths: 24 }).penalty).toBe(penalty);
    },
  );

  it.each([[0, 0], [2, 3600], [24, 43200], [25, 43200]])(
    '月租倍数 %s 对应违约金 %s，限制在 0..24', (penaltyMonths, penalty) => {
      expect(rental({ penaltyBasis: 'rent-multiple', penaltyMonths }).penalty).toBe(penalty);
    },
  );

  it.each([120, 121, Number.MAX_VALUE])('剩余月份 %s 的上界是 120', (remainingMonths) => {
    expect(rental({ remainingMonths })).toEqual({
      ...defaultRentalResult, penalty: 216000, contractClaim: 217800, potentialDifference: 215460,
    });
  });

  it.each([10_000_000, Number.MAX_VALUE])('金额输入 %s 限至千万，但不截断合法计算合计', (amount) => {
    expect(rental({
      monthlyRent: amount, deposit: amount, otherLoss: amount,
      remainingMonths: 120, vacancyMonths: 121, penaltyPercent: 300,
    })).toEqual({
      penalty: 3_600_000_000, depositClaim: 10_000_000, contractClaim: 3_610_000_000,
      estimatedLoss: 1_210_000_000, referenceLow: 1_210_000_000,
      referenceHigh: 1_573_000_000, potentialDifference: 2_037_000_000,
    });
  });

  it.each(invalidNumbers)('每个数值字段都将负数或非有限值 %s 归到零', (value) => {
    expect(rental({ monthlyRent: value })).toEqual({
      penalty: 0, depositClaim: 1800, contractClaim: 1800,
      estimatedLoss: 0, referenceLow: 0, referenceHigh: 0, potentialDifference: 1800,
    });
    expect(rental({ deposit: value })).toEqual({
      ...defaultRentalResult, depositClaim: 0, contractClaim: 10800, potentialDifference: 8460,
    });
    expect(rental({ remainingMonths: value })).toEqual(zeroRentalResult);
    expect(rental({ penaltyPercent: value })).toEqual({
      ...defaultRentalResult, penalty: 0, contractClaim: 1800, potentialDifference: 0,
    });
    expect(rental({ penaltyBasis: 'rent-multiple', penaltyMonths: value })).toEqual({
      ...defaultRentalResult, penalty: 0, contractClaim: 1800, potentialDifference: 0,
    });
    expect(rental({ vacancyMonths: value })).toEqual({
      ...defaultRentalResult, estimatedLoss: 0, referenceLow: 0, referenceHigh: 0, potentialDifference: 12600,
    });
    expect(rental({ otherLoss: value })).toEqual(defaultRentalResult);
  });
});

describe('健身预付服务', () => {
  it('默认按未消费的九个月计算余额及百分之百手续费', () => {
    expect(fitness()).toEqual({
      referenceRefund: 2160, merchantDeduction: 2160, merchantRefund: 0, difference: 2160,
      usedMonths: 3, totalMonths: 12,
    });
  });

  it.each([[0, 0, 2160], [25, 540, 1620], [100, 2160, 0], [101, 2160, 0]])(
    '手续费比例 %s 按余额而非总价计算，限制在 0..100', (feePercent, deduction, refund) => {
      expect(fitness({ feePercent })).toEqual({
        referenceRefund: 2160, merchantDeduction: deduction, merchantRefund: refund, difference: deduction,
        usedMonths: 3, totalMonths: 12,
      });
    },
  );

  it('未使用时全部价款是比例参考额，不等于自动具备全退权利', () => {
    expect(fitness({ usedMonths: 0, feePercent: 25 })).toEqual({
      referenceRefund: 2880, merchantDeduction: 720, merchantRefund: 2160, difference: 720,
      usedMonths: 0, totalMonths: 12,
    });
  });

  it.each([12, 13, 120, Number.MAX_VALUE])('已用月份 %s 不超过总期限', (usedMonths) => {
    expect(fitness({ usedMonths })).toEqual({ ...zeroFitnessAmounts, usedMonths: 12, totalMonths: 12 });
  });

  it('零价格、零月份和零费率安全归零，总期限仍至少一月', () => {
    expect(fitness({ totalPrice: 0, totalMonths: 0, usedMonths: 0, feePercent: 0 })).toEqual({
      ...zeroFitnessAmounts, usedMonths: 0, totalMonths: 1,
    });
  });

  it.each([0, 0.5, 1])('总期限 %s 至少一月，小数已用月份不取整', (totalMonths) => {
    expect(fitness({ totalMonths, usedMonths: 0.25, feePercent: 25 })).toEqual({
      referenceRefund: 2160, merchantDeduction: 540, merchantRefund: 1620, difference: 540,
      usedMonths: 0.25, totalMonths: 1,
    });
  });

  it('支持小数期限及手续费比例', () => {
    expect(fitness({ totalPrice: 99.99, totalMonths: 2.5, usedMonths: 0.5, feePercent: 12.5 })).toEqual({
      referenceRefund: 79.99, merchantDeduction: 10, merchantRefund: 69.99, difference: 10,
      usedMonths: 0.5, totalMonths: 2.5,
    });
  });

  it('手续费及差额使用按分结算的余额，展示金额可以相互核对', () => {
    expect(fitness({ totalPrice: 10.01, totalMonths: 3, usedMonths: 1, feePercent: 25 })).toEqual({
      referenceRefund: 6.67, merchantDeduction: 1.67, merchantRefund: 5, difference: 1.67,
      usedMonths: 1, totalMonths: 3,
    });
  });

  it('不在比例计算前丢失输入的小数精度', () => {
    expect(fitness({ totalPrice: 1.005, totalMonths: 2, usedMonths: 1, feePercent: 0 })).toEqual({
      referenceRefund: 0.5, merchantDeduction: 0, merchantRefund: 0.5, difference: 0,
      usedMonths: 1, totalMonths: 2,
    });
  });

  it.each([120, 121, Number.MAX_VALUE])('总期 %s 限制到 120 月，价格限制到千万', (totalMonths) => {
    expect(fitness({ totalPrice: Number.MAX_VALUE, totalMonths, usedMonths: 6, feePercent: 25 })).toEqual({
      referenceRefund: 9_500_000, merchantDeduction: 2_375_000, merchantRefund: 7_125_000, difference: 2_375_000,
      usedMonths: 6, totalMonths: 120,
    });
  });

  it.each(invalidNumbers)('每个数值字段都安全处理 %s，非法总期回到一月', (value) => {
    expect(fitness({ totalPrice: value })).toEqual({ ...zeroFitnessAmounts, usedMonths: 3, totalMonths: 12 });
    expect(fitness({ totalMonths: value })).toEqual({ ...zeroFitnessAmounts, usedMonths: 1, totalMonths: 1 });
    expect(fitness({ usedMonths: value })).toEqual({
      referenceRefund: 2880, merchantDeduction: 2880, merchantRefund: 0, difference: 2880,
      usedMonths: 0, totalMonths: 12,
    });
    expect(fitness({ feePercent: value })).toEqual({
      referenceRefund: 2160, merchantDeduction: 0, merchantRefund: 2160, difference: 0,
      usedMonths: 3, totalMonths: 12,
    });
  });
});

describe('实习与劳动关系培训费', () => {
  it('默认关系待确认，金额参考为 null 而非零，工资比仅说明量级', () => {
    expect(internship()).toMatchObject({ contractClaim: 10000, ...uncertainReferences, status: 'relationship-uncertain' });
    expect(internship().monthsOfPay).toBeCloseTo(3.787878787878788, 12);
  });

  it.each(['unknown', 'non-labor'] as const)('%s 关系不能因勾选专项培训而套用劳动法参考', (relationship) => {
    for (const specialTraining of [false, true]) {
      expect(internship({ relationship, specialTraining, totalServiceMonths: 0 })).toMatchObject({
        contractClaim: 10000, ...uncertainReferences, status: 'relationship-uncertain',
      });
      expect(internship({ relationship, specialTraining, monthlyPay: 0 }).monthsOfPay).toBeNull();
    }
  });

  it('已成立劳动关系、非专项培训，普通离职培训费参考为零', () => {
    expect(internship({ relationship: 'labor', totalServiceMonths: 0 })).toMatchObject({
      contractClaim: 10000, referenceCeiling: 0, referencePayment: 0,
      potentiallyDisputable: 10000, status: 'ordinary-training',
    });
  });

  it('专项培训按未履行服务期比例计算费用上限', () => {
    expect(internship({ relationship: 'labor', specialTraining: true })).toMatchObject({
      contractClaim: 10000, referenceCeiling: 5000, referencePayment: 5000,
      potentiallyDisputable: 5000, status: 'special-training',
    });
  });

  it.each([[0, 0], [2000, 2000], [5000, 5000]])(
    '约定费用 %s 不高于上限时只展示约定费用，不能反增收费', (contractFee, referencePayment) => {
      expect(internship({ relationship: 'labor', specialTraining: true, contractFee })).toMatchObject({
        contractClaim: contractFee, referenceCeiling: 5000, referencePayment,
        potentiallyDisputable: 0, status: 'special-training',
      });
    },
  );

  it.each([24, 25, 120, Number.MAX_VALUE])('未履行月份 %s 不能超过总服务期', (unservedMonths) => {
    expect(internship({ relationship: 'labor', specialTraining: true, unservedMonths })).toMatchObject({
      contractClaim: 10000, referenceCeiling: 10000, referencePayment: 10000,
      potentiallyDisputable: 0, status: 'special-training',
    });
  });

  it('服务期履行完毕时培训服务期参考为零，不误报事实不足', () => {
    expect(internship({ relationship: 'labor', specialTraining: true, unservedMonths: 0 })).toMatchObject({
      contractClaim: 10000, referenceCeiling: 0, referencePayment: 0,
      potentiallyDisputable: 10000, status: 'special-training',
    });
  });

  it('核实培训费用为零时上限为零', () => {
    expect(internship({ relationship: 'labor', specialTraining: true, trainingCost: 0 })).toMatchObject({
      contractClaim: 10000, referenceCeiling: 0, referencePayment: 0,
      potentiallyDisputable: 10000, status: 'special-training',
    });
  });

  it.each([0, ...invalidNumbers])('专项培训总服务期 %s 无效时三项金额参考为 null', (totalServiceMonths) => {
    expect(internship({ relationship: 'labor', specialTraining: true, totalServiceMonths })).toMatchObject({
      contractClaim: 10000, ...uncertainReferences, status: 'service-period-uncertain',
    });
  });

  it('月份与金额允许小数，分币舍入后的上限与争议部分相互一致', () => {
    expect(internship({
      relationship: 'labor', specialTraining: true, monthlyPay: 200.008, contractFee: 500.02,
      trainingCost: 1000.01, totalServiceMonths: 7.5, unservedMonths: 2.5,
    })).toEqual({
      contractClaim: 500.02, referenceCeiling: 333.34, referencePayment: 333.34,
      potentiallyDisputable: 166.68, monthsOfPay: 2.5, status: 'special-training',
    });
  });

  it('合同费用与培训上限都正确舍入半分', () => {
    expect(internship({
      relationship: 'labor', specialTraining: true, monthlyPay: 10, contractFee: 20.005,
      trainingCost: 10.075, totalServiceMonths: 1, unservedMonths: 1,
    })).toEqual({
      contractClaim: 20.01, referenceCeiling: 10.08, referencePayment: 10.08,
      potentiallyDisputable: 9.93, monthsOfPay: expect.closeTo(2.001, 12), status: 'special-training',
    });
  });

  it.each([120, 121, Number.MAX_VALUE])('服务期 %s 限至 120 月，工资及费用限至千万', (totalServiceMonths) => {
    expect(internship({
      relationship: 'labor', specialTraining: true, monthlyPay: Number.MAX_VALUE,
      contractFee: Number.MAX_VALUE, trainingCost: Number.MAX_VALUE, totalServiceMonths, unservedMonths: 60,
    })).toEqual({
      contractClaim: 10_000_000, referenceCeiling: 5_000_000, referencePayment: 5_000_000,
      potentiallyDisputable: 5_000_000, monthsOfPay: 1, status: 'special-training',
    });
  });

  it.each([0, ...invalidNumbers])('工资 %s 不可作有效分母时只将工资比置为 null', (monthlyPay) => {
    expect(internship({ relationship: 'labor', monthlyPay })).toEqual({
      contractClaim: 10000, referenceCeiling: 0, referencePayment: 0,
      potentiallyDisputable: 10000, monthsOfPay: null, status: 'ordinary-training',
    });
  });

  it.each(invalidNumbers)('合同费用、培训成本及未履行月份分别安全处理 %s', (value) => {
    expect(internship({ relationship: 'labor', specialTraining: true, contractFee: value })).toEqual({
      contractClaim: 0, referenceCeiling: 5000, referencePayment: 0,
      potentiallyDisputable: 0, monthsOfPay: 0, status: 'special-training',
    });
    expect(internship({ relationship: 'labor', specialTraining: true, trainingCost: value })).toMatchObject({
      contractClaim: 10000, referenceCeiling: 0, referencePayment: 0,
      potentiallyDisputable: 10000, status: 'special-training',
    });
    expect(internship({ relationship: 'labor', specialTraining: true, unservedMonths: value })).toMatchObject({
      contractClaim: 10000, referenceCeiling: 0, referencePayment: 0,
      potentiallyDisputable: 10000, status: 'special-training',
    });
  });

  it('零费用与零工资不产生 0/0，也不以零冒充未知关系参考', () => {
    expect(internship({ contractFee: 0, monthlyPay: 0 })).toEqual({
      contractClaim: 0, ...uncertainReferences, monthsOfPay: null, status: 'relationship-uncertain',
    });
  });

  it('极小正工资的比值溢出时返回 null，极小相同服务期仍完整按比例计算', () => {
    expect(internship({
      relationship: 'labor', specialTraining: true, monthlyPay: Number.MIN_VALUE,
      totalServiceMonths: Number.MIN_VALUE, unservedMonths: Number.MIN_VALUE,
    })).toEqual({
      contractClaim: 10000, referenceCeiling: 10000, referencePayment: 10000,
      potentiallyDisputable: 0, monthsOfPay: null, status: 'special-training',
    });
  });
});

describe('数字安全与纯函数', () => {
  it.each([0, -0, Number.MIN_VALUE, 0.005, 0.1, 1.005, 120, 300, Number.MAX_VALUE, ...invalidNumbers])(
    '组合数值 %s 不产生负数、负零、NaN、Infinity 或超过分的金额', (value) => {
      expectSafeResult(rental({
        monthlyRent: value, deposit: value, remainingMonths: value, penaltyPercent: value,
        penaltyMonths: value, vacancyMonths: value, otherLoss: value,
      }));
      expectSafeResult(rental({ penaltyBasis: 'rent-multiple', monthlyRent: value, penaltyMonths: value }));
      expectSafeResult(fitness({ totalPrice: value, totalMonths: value, usedMonths: value, feePercent: value }));
      expectSafeResult(internship({
        relationship: 'labor', specialTraining: true, monthlyPay: value, contractFee: value,
        trainingCost: value, totalServiceMonths: value, unservedMonths: value,
      }));
    },
  );

  it('不修改输入或默认值，重复调用结果一致且返回独立对象', () => {
    const rentalInput = Object.freeze({ ...rentalDefaults });
    const fitnessInput = Object.freeze({ ...fitnessDefaults });
    const internshipInput = Object.freeze({ ...internshipDefaults });
    expect(calculateRental(rentalInput)).toEqual(calculateRental(rentalInput));
    expect(calculateFitness(fitnessInput)).toEqual(calculateFitness(fitnessInput));
    expect(calculateInternship(internshipInput)).toEqual(calculateInternship(internshipInput));
    expect(calculateRental(rentalInput)).not.toBe(calculateRental(rentalInput));
    expect(calculateFitness(fitnessInput)).not.toBe(calculateFitness(fitnessInput));
    expect(calculateInternship(internshipInput)).not.toBe(calculateInternship(internshipInput));
    expect(rentalInput).toEqual(rentalDefaults);
    expect(fitnessInput).toEqual(fitnessDefaults);
    expect(internshipInput).toEqual(internshipDefaults);
  });
});

describe('人民币纯数字格式', () => {
  it.each([
    [0, '0'], [-0, '0'], [1, '1'], [1234, '1,234'], [1234.5, '1,234.5'],
    [1234.567, '1,234.57'], [1000.01, '1,000.01'], [1.005, '1.01'], [10.075, '10.08'],
    [0.001, '0'], [3_610_000_000, '3,610,000,000'],
  ] as const)('将 %s 格式化为 %s，不附加人民币符号或多余零', (value, expected) => {
    expect(formatMoney(value)).toBe(expected);
  });

  it.each(invalidNumbers)('负数或非有限值 %s 安全显示为 0', (value) => {
    expect(formatMoney(value)).toBe('0');
  });

  it('格式化极大有限数时不产生指数、无穷符号或货币符号', () => {
    expect(formatMoney(Number.MAX_VALUE)).toMatch(/^\d{1,3}(,\d{3})*(\.\d{1,2})?$/);
  });
});
