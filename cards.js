// Card purchases retain their use date. Only settlements affect cash.
const validDate=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&!isNaN(Date.parse(v))&&new Date(v+'T00:00:00Z').toISOString().slice(0,10)===v;
const month=v=>v.slice(0,7);
export function cardDate(date,card){
 if(!validDate(date)||!card.paymentDay||!card.cutoffDay)return '';
 const offset=card.paymentMonthOffset??1;
 const d=new Date(Date.UTC(+date.slice(0,4),+date.slice(5,7)-1+offset+(+date.slice(8)>card.cutoffDay?1:0),1));
 const last=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,0)).getUTCDate();
 d.setUTCDate(Math.min(card.paymentDay,last));const result=d.toISOString().slice(0,10);return result<date?'':result;
}
export function settlement(id,name,amount,date,debtId,accountId,extra={}){
 return {id,name,amount,date,debtId,accountId,kind:'repayment',status:'planned',payment:'cash',category:'fixed',incomeType:'regular',certainty:'confirmed',essential:false,principalPart:amount,...extra};
}
export function syncCardPurchases(s){
 const purchases=new Map(s.transactions.filter(t=>t.kind==='expense'&&t.payment==='card'&&t.cardSettlementDate).map(t=>[t.id,t]));
 s.transactions=s.transactions.filter(t=>!t.cardPurchaseId||t.status==='done'||purchases.has(t.cardPurchaseId));
 for(const p of purchases.values()){
  const id='card-settlement:'+p.id,old=s.transactions.find(t=>t.id===id);
  if(old?.status==='done'||old?.overridden)continue;
  const d=s.debts.find(d=>d.id===p.debtId);
  const next=settlement(id,p.name+' · 카드 결제',p.amount,p.cardSettlementDate,p.debtId,d?.paymentAccountId||'',{cardPurchaseId:p.id});
  if(old)Object.assign(old,next);else s.transactions.push(next);
 }
 return s;
}
export function coveredIds(s,b){
 return new Set([...(b.coveredTransactionIds||[]),...s.transactions.filter(t=>t.ruleId&&b.coveredRuleIds?.includes(t.ruleId)&&t.debtId===b.debtId&&month(t.date)===month(b.date)).map(t=>t.id)]);
}
export function cardCandidates(s,debtId,date,excludeId){
 return s.transactions.filter(t=>t.id!==excludeId&&t.kind==='repayment'&&t.debtId===debtId&&month(t.date)===month(date)&&t.status==='planned'&&!t.cardBill&&!t.coveredTransactionIds?.length&&!t.coveredRuleIds?.length);
}
export function validateCards(s){
 for(const r of s.rules||[])if(r.payment==='card'&&(!['fixed','subscription'].includes(r.type)||s.debts.find(d=>d.id===r.debtId)?.type!=='card'||!s.debts.find(d=>d.id===r.debtId)?.paymentDay||!s.debts.find(d=>d.id===r.debtId)?.paymentAccountId))throw Error('카드 정기결제는 결제일·자동이체 계좌 설정을 마친 카드를 선택하세요.');
 for(const d of s.debts){
  if(d.type!=='card')continue;
  for(const k of ['paymentDay','cutoffDay'])if(d[k]!==undefined&&(!Number.isInteger(d[k])||d[k]<1||d[k]>31))throw Error('카드 결제일·이용 마감일은 1~31일입니다.');
  if(d.paymentMonthOffset!==undefined&&![0,1,2].includes(d.paymentMonthOffset))throw Error('카드 결제 월을 확인하세요.');
  if(d.paymentAccountId&&!s.accounts.some(a=>a.id===d.paymentAccountId))throw Error('카드 자동이체 계좌를 확인하세요.');
 }
 const claimed=new Map(),bills=new Set();
 for(const t of s.transactions){
  if(t.cardSettlementDate){if(t.kind!=='expense'||t.payment!=='card'||!validDate(t.cardSettlementDate)||t.cardSettlementDate<t.date)throw Error('카드 결제 예정일은 사용일 이후여야 합니다.');}
  if(t.ruleId&&t.payment==='card'&&!t.overridden&&!t.cardSettlementDate)throw Error('카드 정기 사용일 이후로 결제일이 계산되도록 카드의 결제 월을 설정하세요.');
  if(t.cardPurchaseId){const p=s.transactions.find(p=>p.id===t.cardPurchaseId);if(t.kind!=='repayment'||!p||p.payment!=='card'||p.debtId!==t.debtId||p.cardSettlementDate!==t.date||p.amount!==t.amount)throw Error('카드 구매와 결제 일정이 일치하지 않습니다.');if(t.status==='done'&&p.status!=='done')throw Error('카드 구매를 사용 완료한 뒤 결제를 완료하세요.');}
  if(t.usageMonth!==undefined&&t.usageMonth!==''&&!/^\d{4}-(0[1-9]|1[0-2])$/.test(t.usageMonth))throw Error('카드 이용 월을 확인하세요.');
  if(t.cardBill){if(t.kind!=='repayment'||s.debts.find(d=>d.id===t.debtId)?.type!=='card')throw Error('카드 청구 대상이 잘못되었습니다.');const key=t.debtId+':'+month(t.date);if(bills.has(key))throw Error('같은 카드의 같은 결제 월 청구서는 하나만 등록하세요. 기존 청구서를 수정하세요.');bills.add(key);}
  if(t.coveredTransactionIds!==undefined&&(!Array.isArray(t.coveredTransactionIds)||new Set(t.coveredTransactionIds).size!==t.coveredTransactionIds.length))throw Error('청구 포함 항목이 잘못되었습니다.');
  const ids=coveredIds(s,t);if(!ids.size)continue;
  if(t.kind!=='repayment'||s.debts.find(d=>d.id===t.debtId)?.type!=='card'&&t.coveredTransactionIds?.length)throw Error('카드 청구에만 결제 항목을 연결할 수 있습니다.');
  let total=0,principal=0;
  for(const id of ids){const o=s.transactions.find(o=>o.id===id);if(!o||o.id===t.id||o.kind!=='repayment'||o.debtId!==t.debtId||month(o.date)!==month(t.date)||o.cardBill||o.coveredTransactionIds?.length||o.coveredRuleIds?.length)throw Error('청구 포함 항목의 카드·결제 월을 확인하세요.');if(o.status==='done')throw Error('이미 완료한 결제는 청구 총액에 다시 포함할 수 없습니다.');if(t.status==='done'&&o.cardPurchaseId&&s.transactions.find(p=>p.id===o.cardPurchaseId)?.status!=='done')throw Error('청구에 포함된 카드 구매를 먼저 사용 완료로 처리하세요.');if(claimed.has(id))throw Error('같은 결제 항목을 두 청구액에 중복 포함할 수 없습니다.');claimed.set(id,t.id);total+=o.amount;principal+=o.principalPart;}
  if(total>t.amount||principal>t.principalPart)throw Error('청구 총액·원금은 포함된 결제 항목의 합계보다 작을 수 없습니다.');
 }
 return s;
}
export function effectiveCardTransactions(s){const hidden=new Set();for(const t of s.transactions)for(const id of coveredIds(s,t))hidden.add(id);return s.transactions.filter(t=>!hidden.has(t.id));}
export function addInstallments(s,{name,debtId,accountId,rows}){
 if(!name.trim()||!rows.length||rows.length>120||s.debts.find(d=>d.id===debtId)?.type!=='card'||!s.accounts.some(a=>a.id===accountId))throw Error('할부 이름·카드·결제 계좌를 확인하세요.');
 for(const r of rows)if(!validDate(r.date)||!Number.isSafeInteger(r.amount)||r.amount<=0||!Number.isSafeInteger(r.principalPart)||r.principalPart<0||r.principalPart>r.amount)throw Error('각 회차의 날짜·금액·원금을 확인하세요.');
 if(new Set(rows.map(r=>month(r.date))).size!==rows.length)throw Error('할부는 결제 월마다 한 회차씩 입력하세요.');
 const group=crypto.randomUUID();rows.sort((a,b)=>a.date.localeCompare(b.date)).forEach((r,i)=>s.transactions.push(settlement(crypto.randomUUID(),name+' ('+(i+1)+'/'+rows.length+')',r.amount,r.date,debtId,accountId,{principalPart:r.principalPart,installmentGroup:group,installmentName:name,installmentNumber:i+1,installmentCount:rows.length})));
 return s;
}
