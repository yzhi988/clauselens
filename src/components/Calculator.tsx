import { useEffect, useState } from 'react';
import { ArrowRight, BookOpen, Calculator as CalculatorIcon, RotateCcw, Scale } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { Scenario } from '../engine/types';
import { calculateRental, calculateInternship, calculateFitness, rentalDefaults, internshipDefaults, fitnessDefaults, formatMoney, type RentalInput, type InternshipInput, type FitnessInput } from '../engine/calculators';
import { legalSources } from '../data/rules';

export interface CalculatorLaunch { scenario: Scenario; sequence: number; source: string }
const labels: Record<Scenario, string> = { rental: '租房提前退租', internship: '实习 / 试用期离职', fitness: '健身年卡退费' };
const money = (value: number) => `¥${formatMoney(value)}`;

function AmountControl({ id, label, value, onChange, max, min = 0, step = 1, unit = '元', hint }: { id: string; label: string; value: number; onChange: (value: number) => void; max: number; min?: number; step?: number; unit?: string; hint?: string }) {
  function change(raw: string) { const parsed = Number(raw); onChange(Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : min); }
  return <div className="amount-control"><div className="amount-label"><label htmlFor={`${id}-number`}>{label}</label><div className="number-field"><input id={`${id}-number`} type="number" inputMode="decimal" min={min} max={max} step={step} value={value} onChange={event => change(event.target.value)} /><span>{unit}</span></div></div><input className="amount-slider" type="range" aria-label={`${label}滑块`} aria-describedby={hint ? `${id}-hint` : undefined} min={min} max={max} step={step} value={value} onChange={event => change(event.target.value)} /><div className="slider-scale"><span>{min}</span><span>{formatMoney(max)} {unit}</span></div>{hint && <p id={`${id}-hint`} className="field-hint">{hint}</p>}</div>;
}
function Comparison({ firstLabel, first, secondLabel, second, secondText }: { firstLabel: string; first: number; secondLabel: string; second: number | null; secondText?: string }) {
  const max = Math.max(first, second ?? 0, 1);
  return <div className="comparison" aria-label="金额对比"><div className="comparison-row"><div><span>{firstLabel}</span><strong>{money(first)}</strong></div><div className="comparison-track"><span className="claim-bar" style={{ width: `${first / max * 100}%` }} /></div></div><div className="comparison-row"><div><span>{secondLabel}</span><strong>{secondText ?? (second === null ? '需先确认' : money(second))}</strong></div><div className="comparison-track"><span className="reference-bar" style={{ width: `${(second ?? 0) / max * 100}%` }} /></div></div></div>;
}
function Difference({ label, value, explanation }: { label: string; value: number | null; explanation: string }) {
  return <div className="difference-block"><p><Scale size={16} />{label}</p><output aria-live="polite" className={value === null ? 'unconfirmed-amount' : ''}>{value === null ? '先确认适用前提' : money(value)}</output><p className="difference-explanation">{explanation}</p></div>;
}

export function Calculator({ launch, onReview, onNegotiate }: { launch: CalculatorLaunch | null; onReview: () => void; onNegotiate: () => void }) {
  const [scenario, setScenario] = useState<Scenario>('rental');
  const [rental, setRental] = useState<RentalInput>({ ...rentalDefaults });
  const [internship, setInternship] = useState<InternshipInput>({ ...internshipDefaults });
  const [fitness, setFitness] = useState<FitnessInput>({ ...fitnessDefaults });
  const [source, setSource] = useState('教学示例参数，请按实际合同与事实调整。');
  useEffect(() => {
    if (!launch) return;
    setScenario(launch.scenario);
    if (launch.scenario === 'rental') setRental({ ...rentalDefaults });
    if (launch.scenario === 'internship') setInternship({ ...internshipDefaults });
    if (launch.scenario === 'fitness') setFitness({ ...fitnessDefaults });
    setSource(`${launch.source} · 已载入该场景的教学示例参数，并非自动提取金额。`);
  }, [launch]);
  const rent = calculateRental(rental);
  const intern = calculateInternship(internship);
  const fit = calculateFitness(fitness);
  function reset() {
    if (scenario === 'rental') setRental({ ...rentalDefaults });
    if (scenario === 'internship') setInternship({ ...internshipDefaults });
    if (scenario === 'fitness') setFitness({ ...fitnessDefaults });
    setSource('已恢复教学示例参数，请按实际合同与事实调整。');
  }
  return <section aria-label="违约金与退费计算器">
    <div className="intro-row module-intro"><div><div className="eyebrow"><span />先把数字算清，再把事情谈明白</div><h1>违约金与退费推演<span className="round-label">本地实时计算</span></h1><p className="intro-description">合同写了多少，不等于依法应付多少。拖动滑块，看看差额从哪里来。</p></div><button type="button" className="subtle-button" onClick={onReview}>回到当前合同<ArrowRight size={14} /></button></div>
    <Tabs value={scenario} onValueChange={value => { setScenario(value as Scenario); setSource('教学示例参数，请按实际合同与事实调整。'); }} className="calculator-tabs">
      <div className="scenario-header"><TabsList className="scenario-tabs" aria-label="选择计算场景">{(Object.keys(labels) as Scenario[]).map(id => <TabsTrigger key={id} value={id}>{labels[id]}</TabsTrigger>)}</TabsList><button type="button" onClick={reset} className="subtle-button"><RotateCcw size={13} />恢复示例</button></div>
      <p className="calculator-source" role="status"><CalculatorIcon size={13} />{source}</p>
      <div className="mobile-calculation-summary"><span>{scenario === 'rental' ? '潜在多付差额' : scenario === 'fitness' ? '两方案退费差额' : '可提出异议金额'}<small>基于输入的参考，适用前提见下方</small></span><strong>{scenario === 'rental' ? money(rent.potentialDifference) : scenario === 'fitness' ? money(fit.difference) : intern.potentiallyDisputable === null ? '需先确认' : money(intern.potentiallyDisputable)}</strong></div>
      <TabsContent value="rental" className="calculator-grid">
        <div className="panel calculator-inputs"><div className="section-heading"><span className="step-label">01</span><h2>把合同数字放进来</h2></div>
          <AmountControl id="rent" label="月租金" value={rental.monthlyRent} max={20000} step={50} onChange={monthlyRent => setRental({ ...rental, monthlyRent })} />
          <AmountControl id="deposit" label="押金" value={rental.deposit} max={60000} step={50} onChange={deposit => setRental({ ...rental, deposit })} />
          <AmountControl id="remaining" label="剩余租期" value={rental.remainingMonths} max={36} step={0.5} unit="个月" onChange={remainingMonths => setRental({ ...rental, remainingMonths, vacancyMonths: Math.min(rental.vacancyMonths, remainingMonths) })} />
          <label className="select-label" htmlFor="penalty-basis">合同违约金怎么约定？</label><select id="penalty-basis" value={rental.penaltyBasis} onChange={event => setRental({ ...rental, penaltyBasis: event.target.value as RentalInput['penaltyBasis'] })}><option value="remaining-percent">按剩余租金的百分比</option><option value="rent-multiple">按月租金的倍数</option></select>
          {rental.penaltyBasis === 'remaining-percent' ? <AmountControl id="rent-percent" label="违约金比例" value={rental.penaltyPercent} max={300} unit="%" onChange={penaltyPercent => setRental({ ...rental, penaltyPercent })} /> : <AmountControl id="rent-multiple" label="月租金倍数" value={rental.penaltyMonths} max={12} step={0.5} unit="倍" onChange={penaltyMonths => setRental({ ...rental, penaltyMonths })} />}
          <label className="check-line"><input type="checkbox" checked={rental.forfeitDeposit} onChange={event => setRental({ ...rental, forfeitDeposit: event.target.checked })} /><span>合同还要求另行没收押金<small>若押金只是抵扣同一责任，请取消，避免重复计算。</small></span></label>
          <div className="input-divider"><h3>再估计损失，而非默认“一月封顶”</h3><p>以下是你的假设，不是法院已认定的损失。</p></div>
          <AmountControl id="vacancy" label="估计空置期" value={rental.vacancyMonths} max={rental.remainingMonths} step={0.5} unit="个月" onChange={vacancyMonths => setRental({ ...rental, vacancyMonths })} />
          <AmountControl id="other-loss" label="其他可核实损失" value={rental.otherLoss} max={50000} step={50} hint="损失认定可能包含可得利益；本公式并未穷尽全部损失。" onChange={otherLoss => setRental({ ...rental, otherLoss })} />
        </div>
        <div className="calculator-results"><section className="panel calculation-card"><div className="section-heading"><span className="step-label">02</span><h2>合同主张与协商参考</h2></div><Difference label="潜在多付差额 · 与参考区间高端比较" value={rent.potentialDifference} explanation="仅是合同主张超过 1.3 × 输入损失的部分，不代表一定可以少付。" /><Comparison firstLabel="按合同可能被主张" first={rent.contractClaim} secondLabel="基于输入的协商参考区间" second={rent.referenceHigh} secondText={`${money(rent.referenceLow)} – ${money(rent.referenceHigh)}`} /><div className="formula-note"><p>合同主张 = 违约金 {money(rent.penalty)} + 另扣押金 {money(rent.depositClaim)}</p><p>估计损失 L = {money(rent.estimatedLoss)}；参考区间为 L 至 1.3L。</p>{rental.remainingMonths === 0 && <p>剩余租期为0，本模型归零；不包含欠租、房损等独立责任。</p>}{rent.estimatedLoss === 0 && <p>未输入损失不等于依法免赔。</p>}</div><button type="button" className="calculation-next" onClick={onNegotiate}>去协商与导出 →</button></section>
          <section className="legal-caveat"><h3><BookOpen size={16} />30% 是判断线索，不是法定上限</h3><p>民法典第585条允许依法请求调整违约金。合同编通则司法解释第65条规定，超过第584条损失30%，一般可以认定过分高于损失；损失可包括可得利益。是否调减、调减多少仍需请求、举证并综合履行及过错等因素，恶意违约一般不予调减。</p><a href="https://www.court.gov.cn/fabu/xiangqing/419382.html" target="_blank" rel="noopener noreferrer">最高人民法院 · 第64—66条 ↗</a></section>
        </div>
      </TabsContent>
      <TabsContent value="internship" className="calculator-grid">
        <div className="panel calculator-inputs"><div className="section-heading"><span className="step-label">01</span><h2>先确认关系，再比较金额</h2></div><label className="select-label" htmlFor="relationship">是否依法成立劳动关系？</label><select id="relationship" value={internship.relationship} onChange={event => setInternship({ ...internship, relationship: event.target.value as InternshipInput['relationship'] })}><option value="unknown">尚未确认（不直接给出可拒金额）</option><option value="labor">依法成立劳动关系</option><option value="non-labor">非劳动关系 / 教学实习</option></select><p className="field-hint">以实际用工为准，不因协议写“实习”或“劳务”就能确定。</p>
          <AmountControl id="monthly-pay" label="月补贴 / 薪资" value={internship.monthlyPay} max={50000} step={20} hint="默认 2,640 元仅为 120 元/日 × 22 日的教学估算。" onChange={monthlyPay => setInternship({ ...internship, monthlyPay })} />
          <AmountControl id="training-fee" label="合同培训费 / 离职罚金" value={internship.contractFee} max={200000} step={100} onChange={contractFee => setInternship({ ...internship, contractFee })} />
          {internship.relationship === 'labor' && <><label className="check-line"><input type="checkbox" checked={internship.specialTraining} onChange={event => setInternship({ ...internship, specialTraining: event.target.checked })} /><span>确有符合第22条条件的专项培训与服务期<small>单位专项出资专业技术培训，有真实费用凭证及合法的服务期、违约金约定；普通入职培训不算。</small></span></label>{internship.specialTraining && <div className="training-fields"><AmountControl id="training-cost" label="已核实的专项培训费用" value={internship.trainingCost} max={200000} step={100} onChange={trainingCost => setInternship({ ...internship, trainingCost })} /><AmountControl id="service-total" label="约定服务期" value={internship.totalServiceMonths} max={120} unit="个月" onChange={totalServiceMonths => setInternship({ ...internship, totalServiceMonths, unservedMonths: Math.min(internship.unservedMonths, totalServiceMonths) })} /><AmountControl id="service-left" label="尚未履行服务期" value={internship.unservedMonths} max={internship.totalServiceMonths} unit="个月" onChange={unservedMonths => setInternship({ ...internship, unservedMonths })} /></div>}</>}
        </div>
        <div className="calculator-results"><section className="panel calculation-card"><div className="section-heading"><span className="step-label">02</span><h2>普通培训，不等于离职罚金</h2></div><Difference label="该项罚金中可提出异议的金额" value={intern.potentiallyDisputable} explanation={intern.status === 'ordinary-training' ? '仅限已成立劳动关系、无符合条件的专项培训服务期，且本项不涉有效竞业等其他责任的前提。可依法提出不承担该项普通离职罚金。' : intern.status === 'special-training' ? '只比较超出未履行服务期分摊上限的部分；低于上限也不意味着必然应付。' : '先核实关系及服务期事实；未确认时不把 ¥0 当成法律结论。'} /><Comparison firstLabel="合同约定培训费 / 罚金" first={intern.contractClaim} secondLabel="在已选前提下的计算参考" second={intern.referencePayment} /><div className="formula-note"><p>相当于 {intern.monthsOfPay === null ? '—（月薪为0，无法比较）' : `${formatMoney(intern.monthsOfPay)} 个月补贴 / 薪资`}，仅表示经济量级。</p>{intern.status === 'special-training' && <p>分摊上限 {money(intern.referenceCeiling!)} = 已核实费用 × 未履行期 / 总服务期。</p>}{intern.status === 'service-period-uncertain' && <p>服务期为0，事实不足，不能计算分摊上限。</p>}</div><button type="button" className="calculation-next" onClick={onNegotiate}>去协商与导出 →</button></section><section className="legal-caveat"><h3><BookOpen size={16} />劳动合同法第22 / 25条的前提</h3><p>成立劳动关系时，除法定专项培训服务期及竞业限制情形，不得约定由劳动者承担违约金。非劳动关系的实习不能机械套用这条红线。</p><p>培训费用须符合实施条例第16条的凭证及直接费用要求；依法依第38条解除劳动合同时，按条例第26条不付服务期违约金。本工具不覆盖竞业或违法解约造成的损害赔偿；试用期通常须提前3日通知。</p><a href={legalSources.labor} target="_blank" rel="noopener noreferrer">劳动合同法 · 官方全文 ↗</a><a href="https://xzfg.moj.gov.cn/front/law/detail?LawID=284" target="_blank" rel="noopener noreferrer">实施条例 · 第16 / 26条 ↗</a></section></div>
      </TabsContent>
      <TabsContent value="fitness" className="calculator-grid">
        <div className="panel calculator-inputs"><div className="section-heading"><span className="step-label">01</span><h2>把未使用的期限算出来</h2></div><div className="scope-note">适用于限期不限次的年卡，假设合同已依法解除；不适用于次卡或私教课。</div><AmountControl id="card-price" label="年卡总价" value={fitness.totalPrice} max={50000} step={20} onChange={totalPrice => setFitness({ ...fitness, totalPrice })} /><AmountControl id="card-total" label="年卡总月数" value={fitness.totalMonths} min={1} max={60} unit="个月" onChange={totalMonths => setFitness({ ...fitness, totalMonths, usedMonths: Math.min(fitness.usedMonths, totalMonths) })} /><AmountControl id="card-used" label="已使用月数" value={fitness.usedMonths} max={fitness.totalMonths} step={0.5} unit="个月" onChange={usedMonths => setFitness({ ...fitness, usedMonths })} /><AmountControl id="card-fee" label="商家扣除手续费比例" value={fitness.feePercent} max={100} unit="%" hint="手续费以未消费余额为基数；这里只模拟商家方案，不认定扣费合法。" onChange={feePercent => setFitness({ ...fitness, feePercent })} /></div><div className="calculator-results"><section className="panel calculation-card"><div className="section-heading"><span className="step-label">02</span><h2>剩余期限，不该被忽略</h2></div><Difference label="两种方案的退费差额" value={fit.difference} explanation="剩余比例参考退还额 − 商家方案退款；是否有权解除、具体扣费争议仍需核实。" /><Comparison firstLabel="商家按该方案退还" first={fit.merchantRefund} secondLabel="依法解除后的剩余比例参考" second={fit.referenceRefund} /><div className="formula-note"><p>未消费比例额 = {money(fitness.totalPrice)} × ({fit.totalMonths} − {fit.usedMonths}) / {fit.totalMonths}</p><p>商家拟扣手续费：{money(fit.merchantDeduction)}</p></div><button type="button" className="calculation-next" onClick={onNegotiate}>去协商与导出 →</button></section><section className="legal-caveat"><h3><BookOpen size={16} />剩余期限比例，有明确适用范围</h3><p>法释〔2025〕4号第22条：限期不限次服务合同依法解除后，按剩余期限占比退款；提前停止服务，可从停服时计算。消费者自身原因到期未使用，不能据此要求退款。</p><p>本模型按月近似，不赋予任意解除权。次卡、私教、赠品或折扣等应按实际服务及第15—21条另行判断，不能直接套用本结果。</p><a href="https://www.court.gov.cn/zixun/xiangqing/459321.html" target="_blank" rel="noopener noreferrer">最高人民法院 · 预付式消费解释 ↗</a></section></div>
      </TabsContent>
    </Tabs>
  </section>;
}
