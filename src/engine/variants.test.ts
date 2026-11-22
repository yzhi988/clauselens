import { describe, expect, it } from 'vitest';
import { rules } from '../data/rules';
import { scanContract } from './scanner';
import type { RiskRule, ScanScenario } from './types';

// Independently hand-written, realistic-style fixtures, not collected contracts
// and not derived from the teaching samples. Each row exercises five expressions.
const fixtures = [
  {
    id: 'rental-deposit',
    positive: [
      '合同到期或中途退房，押金概不退还。',
      '租客提前搬走的，房东将扣除全部押金。',
      '交房时保证金全额没收，不再另行结算。',
      '因个人原因退租押金不予返还。',
      '甲方可以自行决定扣减押金，乙方不得提出异议。',
    ],
    negative: [
      '出租人不得扣除全部押金，应提供实际损失凭证。',
      '押金不得约定概不退还。',
      '不得约定“押金概不退还”，退房后按实际欠费结算。',
      '保证金应当在结清水电后原路退还，不得随意扣款。',
    ],
  },
  {
    id: 'rental-penalty',
    positive: [
      '乙方提前退租须扣除3个月租金。',
      '提前解约应按剩余租期的房租赔付。',
      '乙方提前退租应补齐未到期全部租金。',
      '本合同退租违约金相当于两个月的房租。',
      '未住满一年搬离应以三个月租金赔偿。',
    ],
    negative: [
      '提前退租按实际空置损失协商结算，重新出租后不重复计费。',
      '提前退租无需支付3个月租金。',
      '不得约定退租违约金为6个月租金。',
      '乙方按月支付租金，剩余租期可以协商由新租客承接。',
    ],
  },
  {
    id: 'rental-increase',
    positive: [
      '房东可以在租期内随时涨价，承租人须接受。',
      '房租由甲方根据市场行情自行调整。',
      '出租人可根据市场行情另行调整房租。',
      '无需征得承租人同意即可提高房租。',
      '房租可不定期调涨，新的标准以通知为准。',
    ],
    negative: [
      '本租期内租金不变；续约租金由双方协商确定。',
      '房东不得随时涨价，租金变更必须双方书面同意。',
      '租期届满续约时，双方协商一致后另行调整房租。',
      '不得约定房租由甲方自行调整。',
    ],
  },
  {
    id: 'rental-eviction',
    positive: [
      '甲方有权随时要求乙方搬离，乙方须自行找房。',
      '房东无需提前通知即可换锁，钥匙不再提供。',
      '出租人可以通过断水断电迫使租客搬离。',
      '逾期未搬离的物品由甲方直接丢弃。',
      '房东无需任何理由即可解除租约。',
    ],
    negative: [
      '甲方不得擅自换锁或清走租客物品。',
      '房东依法解除后应书面通知，并与租客协商合理腾退期限。',
      '禁止通过断水断电迫使租客搬离。',
      '有生效裁判且拒不搬离的，出租人可依法申请强制执行。',
    ],
  },
  {
    id: 'rental-wear',
    positive: [
      '自然磨损的修理由租客负责维修。',
      '家电自然老化需要更新的，乙方按原价赔偿。',
      '退房时无论有无损坏均须支付翻新费。',
      '正常损耗也要按新品价格赔偿。',
      '承租人须承担自然老化产生的全部费用。',
    ],
    negative: [
      '正常损耗免赔，使用不当造成的损坏按实际损失处理。',
      '自然老化的维修费用不由承租人承担。',
      '正常使用导致的损耗无需赔偿，家具交付状态以照片为准。',
      '不得要求正常损耗按原价赔偿。',
    ],
  },
  {
    id: 'rental-sublet',
    positive: [
      '二房东无法提供业主的转租授权，签约即视为认可。',
      '未经原出租人同意直接对外转租。',
      '转租人不保证取得房东的转租许可。',
      '转租房屋被业主收回，全部损失由租客自行承担。',
      '该房屋没有业主的转租授权仍可签约。',
    ],
    negative: [
      '未经房东同意不得转租，应先核验原租赁合同。',
      '甲方应提供业主书面转租授权供乙方核对。',
      '转租人已取得原出租人同意，转租期限不超过原租约。',
      '不得约定转租人不保证取得房东的转租许可。',
    ],
  },
  {
    id: 'internship-training',
    positive: [
      '本人离职须赔偿培训费8000元。',
      '辞职时应返还公司垫付的入职培训费。',
      '未做满六个月离职将扣除岗前培训费。',
      '辞职时从工资中直接扣回培训成本。',
      '日常培训成本在离职时全额返还。',
    ],
    negative: [
      '实习生离职无需支付培训费，也无需赔偿培训违约金。',
      '公司出资专项技术培训，有真实费用凭证，离职须支付培训费但不超过按剩余服务期应分摊的部分。',
      '单位出资专项专业技术培训并留存凭证，按尚未履行服务期分摊实际费用，辞职时应赔偿培训费。',
      '不得约定“离职须支付培训费5000元”。',
    ],
  },
  {
    id: 'internship-noncompete',
    positive: [
      '竞业限制补偿金已经包含在每月工资中，不再另行给付。',
      '月薪中已含竞业补偿，离职以后不额外付钱。',
      '离职后24个月不得入职竞品，补偿已含月薪。',
      '履行竞业限制期间不另行支付经济补偿。',
      '离职后36个月内禁止进入同行企业。',
    ],
    negative: [
      '对依法适用的涉密人员约定竞业限制两年，离职后另行按月支付经济补偿。',
      '离职后24个月不得入职竞品，公司依法按月另付竞业补偿。',
      '竞业补偿不包含在月薪中，离职后另行按月支付。',
      '公司不得约定竞业补偿已含月薪。',
    ],
  },
  {
    id: 'internship-pay',
    positive: [
      '公司可以随意扣发工资，无须另行说明。',
      '实习补贴由甲方任意调整，以每月通知为准。',
      '辞职当月的工资一律不予发放。',
      '经营困难，公司可停发实习补贴。',
      '甲方有权以任何理由扣除报酬。',
    ],
    negative: [
      '公司不得任意克扣工资，补贴应按约及时发放。',
      '实习补贴按实际出勤计算，扣减须有合法依据和明细。',
      '离职当月工资按出勤天数足额结算。',
      '不得约定公司可随意扣发工资。',
    ],
  },
  {
    id: 'internship-dismissal',
    positive: [
      '公司可任意单方终止实习关系。',
      '甲方有权解除本合同无需任何理由。',
      '无条件随时解除不予补偿。',
      '公司随时辞退实习生，不支付任何经济补偿。',
      '公司无需任何理由即可解除实习协议。',
    ],
    negative: [
      '公司仅在符合法定事由时依法即时解除劳动合同，无需经济补偿。',
      '员工严重违反规章制度时，公司依法可随时单方解除劳动合同，无需提前通知。',
      '实习结束应结清报酬，双方根据法律关系协商合理通知期。',
      '不得约定无条件随时解除不予补偿。',
    ],
  },
  {
    id: 'internship-overtime',
    positive: [
      '实习生必须服从公司一切加班安排。',
      '延长工作时间一律不计薪。',
      '甲方要求的节假日加班不另付加班费。',
      '加班不安排补休，也不支付报酬。',
      '拒绝加班视为旷工处理。',
    ],
    negative: [
      '不得强制加班，加班安排须协商并遵守工时规定。',
      '加班依法支付报酬或安排适用的补休。',
      '公司不得要求无偿加班。',
      '禁止约定拒绝加班视为旷工处理。',
    ],
  },
  {
    id: 'internship-ip',
    positive: [
      '入职前已有的作品全部归公司。',
      '业余时间独立开发的项目归甲方所有。',
      '与工作无关的个人成果也属于公司。',
      '离职后创作的全部作品归甲方。',
      '个人项目的知识产权自动转让给公司。',
    ],
    negative: [
      '职务作品依法及依合法约定确定权属，个人项目归本人。',
      '入职前完成的作品不当然归公司。',
      '与工作无关的个人成果不属于甲方。',
      '不得约定个人项目的知识产权自动转让给公司。',
    ],
  },
  {
    id: 'fitness-refund',
    positive: [
      '一经售出不退不换，请付款前自行确认。',
      '申请退卡须扣除30%手续费。',
      '退费违约金按余额的百分之三十收取。',
      '无论什么原因，一律不退款。',
      '已缴的会员费概不退还。',
    ],
    negative: [
      '不得约定“一经售出不退不换”。',
      '退卡不得扣除30%手续费。',
      '因门店违约解除的，依法退还未履行部分费用。',
      '退费应区分解除原因和已消费金额，按合法约定结算。',
    ],
  },
  {
    id: 'fitness-closure',
    positive: [
      '卡内余额逾期作废，过期后不再查询。',
      '储值卡到期后剩余金额全部清零。',
      '因经营原因关店，未消费款项一律不退。',
      '健身房倒闭后无需退款，会员自行承担。',
      '储值卡余额于有效期届满后自动没收。',
    ],
    negative: [
      '门店闭店后应当依法退还剩余费用。',
      '限期不限次年卡到期仅使用权终止，未使用的时间不自动延长。',
      '储值卡到期可以免费延期，余额不作废。',
      '不得约定卡内余额逾期作废。',
    ],
  },
  {
    id: 'fitness-injury',
    positive: [
      '运动期间发生的任何人身伤害与本店无关。',
      '人身损害一律由会员自行承担。',
      '因器械故障导致受伤，商家不承担赔偿责任。',
      '场馆对一切人身伤害均免责。',
      '使用器械即自愿放弃所有人身损害索赔权。',
    ],
    negative: [
      '设备缺陷造成损害由场馆依法承担相应责任。',
      '人身伤害不得一概免责，应依法认定责任。',
      '会员注意自身安全，场馆应维护器械并作必要提示。',
      '禁止约定场馆对一切人身伤害均免责。',
    ],
  },
  {
    id: 'fitness-hours',
    positive: [
      '本店有权随时缩短营业时间。',
      '开放时间由甲方自行决定。',
      '团课可由本店任意取消。',
      '取消团课不提供任何补偿。',
      '甲方无需征得会员同意即可关闭设施。',
    ],
    negative: [
      '营业时间变更须经会员书面同意。',
      '临时设备检修提前公告并提供合理延期，不减少已购权益。',
      '本店不得单方面缩短营业时间。',
      '不得约定团课由本店随时取消。',
    ],
  },
  {
    id: 'fitness-fees',
    positive: [
      '门店有权另行加收设备维护费。',
      '持卡人须额外缴纳入场费。',
      '拒交新增维护费即暂停会员资格。',
      '年卡有效期内还需补交服务费。',
      '年卡原有课程可再次收费。',
    ],
    negative: [
      '原有年卡服务不再追加费用。',
      '新增私教课程明码标价，自愿购买，不影响原有会员权益。',
      '不得随时增收设备维护费。',
      '禁止约定持卡人须额外缴纳入场费。',
    ],
  },
  {
    id: 'fitness-interpretation',
    positive: [
      '本协议最终解释权归公司所有。',
      '本店保留活动规则的最终解释权。',
      '本合同的解释权由甲方单方决定。',
      '如有歧义，一律以本店的解释为准。',
      '公司对本协议的解释具有最终效力。',
    ],
    negative: [
      '不得约定最终解释权归本店所有。',
      '条款按通常理解解释，有歧义依法作不利于提供方的解释。',
      '甲方不享有最终解释权，争议可依法申请仲裁或诉讼。',
      '禁止约定“最终解释权归甲方”。',
    ],
  },
];

const ids = (text: string, scenario: ScanScenario = 'auto', ruleSet: RiskRule[] = rules) =>
  scanContract(text, scenario, ruleSet).hits.map(hit => hit.rule.id);

for (const fixture of fixtures) {
  const rule = rules.find(item => item.id === fixture.id)!;
  describe(fixture.id, () => {
    for (const mode of ['auto', rule.scenario] as const) {
      it.each(fixture.positive)(`${mode} 完整表达：%s`, text => {
        expect(ids(text, mode)).toEqual([fixture.id]);
      });
      it.each(fixture.negative)(`${mode} 否定/合理约定：%s`, text => {
        expect(ids(text, mode)).toEqual([]);
      });
    }

    it.each(fixture.positive)('高置信表达不借用上下文：%s', text => {
      const noContext = { ...rule, context: /NEVER_MATCH_CONTEXT/ };
      expect(ids(text, 'auto', [noContext])).toEqual([fixture.id]);
    });

    it.each(fixture.positive)('禁止约定完整表达不产生嵌套误报：%s', text => {
      const expression = text.replace(/[。！？]$/u, '');
      expect(ids(`不得约定“${expression}”。`, rule.scenario)).toEqual([]);
    });

    it('显式场景只扫描本场景', () => {
      const other = rule.scenario === 'rental' ? 'internship' : 'rental';
      for (const text of fixture.positive) expect(ids(text, other)).toEqual([]);
    });
  });
}

describe('变体扫描边界与范围', () => {
  it('十八条均有五组完整表达，并将它们保留在普通 patterns 中', () => {
    expect(fixtures.map(fixture => fixture.id).sort()).toEqual(rules.map(rule => rule.id).sort());
    for (const rule of rules) {
      expect(rule.standalonePatterns).toHaveLength(5);
      expect(rule.standalonePatterns!.every(pattern => rule.patterns.includes(pattern))).toBe(true);
    }
  });

  it.each([
    '押金概不退还。',
    '扣除全部押金。',
    '提前退租扣除2个月租金。',
    '离职须支付培训费XX元。',
    '离职须赔偿培训费人民币5000元。',
    '离职后24个月不得入职竞品且补偿已含月薪。',
    '无条件随时解除不予补偿。',
    '一经售出不退不换。',
    '退卡扣除30%违约金。',
    '卡内余额逾期作废。',
    '最终解释权归本店。',
    '最终解释权归公司。',
    '最终解释权归甲方。',
  ])('核心孤句 auto 可识别：%s', text => {
    expect(scanContract(text).hits).toHaveLength(1);
  });

  it.each(['培训', '补偿', '解除', '解释', '任意扣除补贴', '强制加班', '无偿加班'])('弱词仍需上下文：%s', text => {
    expect(ids(text)).toEqual([]);
  });

  it('强表达不解锁同规则或其他规则的弱表达', () => {
    const text = '公司可以随意扣发工资。任意扣除补贴。强制加班。';
    const result = scanContract(text);
    expect(result.hits.map(hit => hit.rule.id)).toEqual(['internship-pay']);
    expect(result.hits[0].excerpt).toBe('公司可以随意扣发工资');
    expect(result.hits[0].ranges).toEqual([{ start: 0, end: 10 }]);
    expect(ids(`实习协议。${text}`)).toEqual(['internship-pay', 'internship-overtime']);
    const explicit = scanContract(text, 'internship');
    expect(explicit.hits[0].ranges).toHaveLength(2);
    expect(explicit.hits[1].excerpt).toBe('强制加班');
  });

  it.each([
    ['不得扣除全部押金。', '扣除全部押金。', 'rental-deposit'],
    ['不得约定最终解释权归甲方。', '最终解释权归甲方。', 'fitness-interpretation'],
    ['不得约定一经售出不退不换。', '一经售出不退不换。', 'fitness-refund'],
    ['离职无需支付培训费。', '离职须赔偿培训费8000元。', 'internship-training'],
    ['公司出资专项技术培训，有费用凭证，按剩余服务期分摊费用，离职须支付培训费。', '离职须支付培训费5000元。', 'internship-training'],
    ['公司依法在严重违反规章制度时可随时单方解除劳动合同，无需提前通知。', '无条件随时解除不予补偿。', 'internship-dismissal'],
    ['正常损耗免赔。', '正常损耗按新品价格赔偿。', 'rental-wear'],
    ['闭店应退还剩余费用。', '卡内余额逾期作废。', 'fitness-closure'],
  ])('安全句不会掩盖后续风险：%s', (safe, risky, id) => {
    const text = safe + risky;
    const result = scanContract(text);
    expect(result.hits.map(hit => hit.rule.id)).toEqual([id]);
    for (const range of result.hits[0].ranges) {
      expect(range.start).toBeGreaterThanOrEqual(safe.length);
      expect(range.end).toBeLessThanOrEqual(text.length);
    }
    expect(ids(risky + safe)).toEqual([id]);
  });

  it('同句逗号两侧的禁止表达不掩盖另一项明确风险', () => {
    const text = '不得扣除全部押金，但退租押金不退。';
    const result = scanContract(text);
    expect(result.hits).toHaveLength(1);
    expect(result.hits[0].excerpt).toBe('退租押金不退');
  });

  it('仅提到专项培训、凭证或分摊，不足以抑制不区分情况的全额收费', () => {
    const text = '公司安排专项技术培训，有费用凭证，按剩余服务期分摊费用，但离职一律全额支付培训费。';
    expect(ids(text)).toEqual(['internship-training']);
    expect(ids('离职须支付培训费8000元；培训并非专项技术培训，没有费用凭证。')).toEqual(['internship-training']);
  });

  it.each(['。', '；', ';', '！', '？', '!', '?', '\n'])('否定范围不过句界 %s', delimiter => {
    const safe = `正常损耗无需赔偿${delimiter}`;
    const risk = '正常损耗按原价赔偿';
    const text = safe + risk;
    const result = scanContract(text, 'rental');
    expect(result.hits.map(hit => hit.rule.id)).toEqual(['rental-wear']);
    expect(result.hits[0].ranges).toEqual([{ start: safe.length, end: text.length }]);
  });

  it('引号内部禁止内容不影响闭引号后的风险', () => {
    for (const [open, close] of [['“', '”'], ['「', '」'], ['"', '"']]) {
      const safe = `不得约定${open}本协议最终解释权归公司所有${close}，`;
      const risk = '最终解释权归本店';
      const result = scanContract(safe + risk);
      expect(result.hits).toHaveLength(1);
      expect(result.hits[0].ranges).toEqual([{ start: safe.length, end: safe.length + risk.length }]);
    }
  });

  it.each([
    '正常损耗无需按新品价格赔偿。',
    '家电自然老化无需按原价赔偿。',
    '家电自然老化需要更新的，乙方无需按原价赔偿。',
    '因器械故障导致受伤，商家不得免责。',
    '实习期间个人作品的全部知识产权不应无偿归甲方。',
    '双方协商一致后，甲方可另行调整房租。',
    '经承租人书面同意后，房东可另行调整房租。',
    '房东不得另行调整房租。',
    '本店不得随时缩短营业时间。',
    '公司不得任意单方终止实习关系。',
    '员工无需服从公司一切加班安排。',
    '公司不得以任何理由扣除报酬。',
  ])('否定和协商条件位于完整表达内部：%s', text => {
    expect(ids(text)).toEqual([]);
    for (const scenario of ['rental', 'internship', 'fitness'] as const) expect(ids(text, scenario)).toEqual([]);
  });

  it.each([
    '提前退租，须扣除三个月租金。',
    '提前退租按3个月租金赔付。',
    '提前解约，按剩余租期的全部租金赔偿。',
    '提前退租按剩余租期赔付。',
    '提前退租，扣除2个月租金作为违约金。',
  ])('退租月数和剩余租金支持常见语序：%s', text => {
    expect(ids(text)).toEqual(['rental-penalty']);
  });

  it.each([
    '最终解释权归本店',
    '卡内余额逾期作废',
    '保证金全额没收',
    '房租可不定期调涨',
  ])('编号后无标点风险首行不被当成标题：%s', expression => {
    const result = scanContract(`第一条 ${expression}\n双方签字后生效。`);
    expect(result.clauses[0].title).toBe('');
    expect(result.clauses[0].text).toBe(`${expression}\n双方签字后生效。`);
    expect(result.hits).toHaveLength(1);
    expect(result.hits[0].ranges).toEqual([{ start: 0, end: expression.length }]);
  });

  it('UTF-16 半开范围保留内部空格、CRLF和非 BMP 字符，重复只计一次', () => {
    const body = '𠮷提醒：押金\u3000概不退还。\r\n另行确认：押金\u3000概不退还。';
    const result = scanContract(`第一条 费用说明\r\n${body}`);
    const phrase = '押金\u3000概不退还';
    expect(result.clauses[0].text).toBe(body);
    expect(result.hits).toHaveLength(1);
    expect(result.hits[0].ranges).toEqual([
      { start: body.indexOf(phrase), end: body.indexOf(phrase) + phrase.length },
      { start: body.lastIndexOf(phrase), end: body.lastIndexOf(phrase) + phrase.length },
    ]);
    expect(result.hits[0].excerpt).toBe(`${phrase} … ${phrase}`);
    expect(result.counts).toEqual({ high: 1, medium: 0, low: 0 });
  });

  it('阿拉伯/全角月数、百分比和空白不改变原始偏移', () => {
    for (const text of ['提前退租扣除 １２ 个月租金。', '退卡收取３０％手续费。', '退卡扣除30.5%违约金。']) {
      const result = scanContract(text);
      expect(result.hits).toHaveLength(1);
      expect(result.hits[0].ranges).toEqual([{ start: 0, end: text.length - 1 }]);
      expect(result.hits[0].excerpt).toBe(text.slice(0, -1));
    }
  });

  it('保留注入规则 API；standalone 和 ignore 的正则状态、标志均不变', () => {
    const ordinary = /weak/iy;
    const standalone = /RISK/iy;
    const ignore = /NO RISK/iy;
    const context = /CONTEXT/gy;
    const injected: RiskRule = { ...rules[0], patterns: [ordinary], standalonePatterns: [standalone], ignorePatterns: [ignore], context };
    for (const regex of [ordinary, standalone, ignore, context]) regex.lastIndex = 42;
    const text = 'no risk. RISK. weak.';
    const result = scanContract(text, 'auto', [injected]);
    expect(result.hits[0].ranges).toEqual([{ start: 9, end: 13 }]);
    expect(scanContract(text, 'auto', [injected])).toEqual(result);
    expect(scanContract(text, 'rental', [injected]).hits[0].ranges).toEqual([{ start: 9, end: 13 }, { start: 15, end: 19 }]);
    expect(scanContract(`prefix CONTEXT. ${text}`, 'auto', [injected]).hits[0].ranges).toHaveLength(2);
    for (const regex of [ordinary, standalone, ignore, context]) expect(regex.lastIndex).toBe(42);
  });

  it('忽略范围先于合并处理，不用部分重叠抹去有效表达', () => {
    const injected: RiskRule = {
      ...rules[0], patterns: [/ab/, /bc/, /de/, /ef/], standalonePatterns: [], ignorePatterns: [/ab/, /f/],
    };
    expect(scanContract('abcdef', 'rental', [injected]).hits[0].ranges).toEqual([{ start: 1, end: 3 }, { start: 3, end: 6 }]);
  });

  it('新增两个可选数组仍安全处理空匹配和 Unicode', () => {
    const injected: RiskRule = {
      ...rules[0], patterns: [], standalonePatterns: [/(?:)/gu, /RISK/], ignorePatterns: [/(?:)/gu], context: /never/,
    };
    expect(scanContract('𠮷RISK', 'auto', [injected]).hits[0].ranges).toEqual([{ start: 2, end: 6 }]);
  });

  it('50k 无标点长句仍有合理耗时，末尾范围准确', () => {
    const suffix = '离职须赔偿培训费8000元';
    const filler = '正常损耗培训补偿解释解除';
    const text = filler.repeat(Math.ceil(50_000 / filler.length)).slice(0, 50_000 - suffix.length) + suffix;
    const start = performance.now();
    const result = scanContract(text);
    expect(performance.now() - start).toBeLessThan(2000);
    expect(result.clauses[0].text).toHaveLength(50_000);
    expect(result.hits.map(hit => hit.rule.id)).toEqual(['internship-training']);
    expect(result.hits[0].ranges).toEqual([{ start: 50_000 - suffix.length, end: 50_000 }]);
  });

  it('50k 重复安全/风险表达不会全局抑制或形成二次方范围过滤', () => {
    const safe = '不得约定最终解释权归公司。';
    const risk = '最终解释权归公司。';
    const repeats = Math.floor(50_000 / (safe.length + risk.length));
    const text = (safe + risk).repeat(repeats);
    const start = performance.now();
    const result = scanContract(text);
    expect(performance.now() - start).toBeLessThan(2000);
    expect(result.hits).toHaveLength(1);
    expect(result.hits[0].ranges).toHaveLength(repeats);
    expect(result.hits[0].ranges[0]).toEqual({ start: safe.length, end: safe.length + risk.length - 1 });
    expect(result.hits[0].ranges.at(-1)).toEqual({ start: text.length - risk.length, end: text.length - 1 });
  });
});
