import {money,localDate} from './engine.js';
import {cardDate,settlement,cardCandidates,coveredIds,addInstallments} from './cards.js';
import {monthAdd,dueDate} from './planning.js';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const $=s=>document.querySelector(s);
const input=(name,label,type,value,extra='')=>`<label>${label}<input name="${name}" type="${type}" value="${esc(value)}" ${extra}></label>`;
const select=(name,label,items,value)=>`<label>${label}<select name="${name}">${items.map(([v,l])=>`<option value="${esc(v)}" ${v===value?'selected':''}>${esc(l)}</option>`).join('')}</select></label>`;
export function cardsMarkup(s,month){
 const cards=s.debts.filter(d=>d.type==='card');
 return `<div class="notice">이용 월은 카드를 쓴 달, 결제 월은 통장에서 돈이 나가는 달입니다. 자동이체 설정은 일정 예측용이며 실제 이체 후 직접 완료하세요.</div><section class="card"><h2>카드 결제 관리</h2><p class="muted">청구 총액에 이미 들어 있는 할부·일시불 결제를 선택하면 한 번만 계산합니다. 할부를 제외한 추가 금액은 “추가 결제액”으로 입력하세요.</p><div class="actions"><button id="card-bill">+ 청구 총액</button><button id="card-extra">+ 추가 결제액</button><button id="card-installments">+ 회차별 할부</button></div></section>`+cards.map(d=>{
 const payments=s.transactions.filter(t=>t.kind==='repayment'&&t.debtId===d.id&&t.date.startsWith(month));
 const hidden=new Set(s.transactions.flatMap(t=>[...coveredIds(s,t)]));
 const total=payments.filter(t=>!hidden.has(t.id)&&t.status==='planned').reduce((n,t)=>n+t.amount,0);
 return `<section class="card" style="margin-top:16px"><div class="section-head"><h2>${esc(d.name)}</h2><button data-card-config="${esc(d.id)}">결제 설정</button></div><p class="muted">${d.paymentDay?`매월 ${d.paymentDay}일 결제 · ${d.cutoffDay}일 이용 마감 · ${['당월','다음 달','두 달 뒤'][d.paymentMonthOffset??1]} 결제 · ${esc(s.accounts.find(a=>a.id===d.paymentAccountId)?.name||'계좌 미지정')}`:'결제 설정 후 새 카드 구매의 결제일을 자동 제안합니다.'}</p><div class="line"><span>${month} 남은 결제액</span><b>${money(total)}</b></div>${payments.map(t=>`<div class="row card-payment-row"><div class="row-body"><strong>${esc(t.name)}</strong><span class="muted">결제 ${t.date} ${t.usageMonth?'· 이용 '+esc(t.usageMonth):''} · ${hidden.has(t.id)?'청구 총액에 포함':t.status==='done'?'결제 완료':'결제 예정'}${t.cardPurchaseId?' · 카드 사용과 연결':''}</span></div><b>${money(t.amount)}</b><div class="actions">${!hidden.has(t.id)&&t.status==='planned'?`<button data-complete="${esc(t.id)}">완료</button>`:''}<button ${t.cardBill?'data-bill-edit':t.cardPurchaseId?'data-edit-purchase':'data-edit'}="${esc(t.cardPurchaseId||t.id)}">수정</button>${!t.cardPurchaseId?`<button data-delete="${esc(t.id)}">삭제</button>`:''}</div></div>`).join('')||'<div class="empty">이 결제 월에 등록된 금액이 없습니다.</div>'}</section>`;
 }).join('')+(!cards.length?'<div class="notice">계좌 · 부채에서 카드와 결제 통장을 먼저 등록하세요.</div>':'');
}
export function bindCards(s,save,month,edit){
 const cards=s.debts.filter(d=>d.type==='card');
 document.querySelectorAll('[data-card-config]').forEach(b=>b.onclick=()=>edit('debt',s.debts.find(d=>d.id===b.dataset.cardConfig)));
 document.querySelectorAll('[data-edit-purchase]').forEach(b=>b.onclick=()=>edit('transaction',s.transactions.find(t=>t.id===b.dataset.editPurchase)));
 function open(title,html,submit){$('#form-title').textContent=title;$('#form-error').textContent='';$('#fields').innerHTML=html;window.dispatchEvent(new Event('ledger-form-open'));$('#modal').showModal();$('#form').onsubmit=e=>{e.preventDefault();try{const n=structuredClone(s);submit(new FormData(e.target),n);save(n);$('#modal').close();}catch(err){$('#form-error').textContent=err.message;}};}
 const choices=cards.map(d=>[d.id,d.name]),accounts=s.accounts.map(a=>[a.id,a.name]);
 function bill(item=null,extra=false){
  if(!cards.length||!accounts.length){edit('debt');return;}
  const d=cards.find(d=>d.id===item?.debtId)||cards[0],date=item?.date||dueDate(month,d.paymentDay||15);
  open(extra?'카드 추가 결제액':'카드 청구 총액',select('debtId','카드',choices,d.id)+input('date','실제 결제 예정일','date',date,'required')+input('usageMonth','카드사 청구서의 이용 월 (선택)','month',item?.usageMonth||'')+select('accountId','자동이체 계좌',accounts,item?.accountId||d.paymentAccountId||accounts[0][0])+input('name','이름','text',item?.name||(extra?'추가 카드 결제':'카드 청구 총액'),'required maxlength="80"')+input('amount',extra?'기존 할부·결제액을 제외한 추가 금액':'카드사 청구 총액 (할부 포함)','number',item?.amount||'','required min="1" step="1"')+input('principalPart','청구액 중 원금 (할부 수수료·이자 제외)','number',item?.principalPart||'','required min="0" step="1"')+'<div id="card-included"></div><p class="muted">입력한 결제일의 월에 반영합니다. 실제 이체를 확인한 뒤 완료 처리하세요.</p>',(f,n)=>{
   const debtId=f.get('debtId'),date=f.get('date');
   const obj=settlement(item?.id||crypto.randomUUID(),f.get('name'),Number(f.get('amount')),date,debtId,f.get('accountId'),{...item,amount:Number(f.get('amount')),principalPart:Number(f.get('principalPart')),date,debtId,accountId:f.get('accountId'),name:f.get('name'),usageMonth:f.get('usageMonth'),cardBill:!extra,coveredRuleIds:[],coveredTransactionIds:extra?[]:f.getAll('coveredTransactionIds')});
   if(obj.status==='done'&&date>localDate())throw Error('완료된 청구서는 미래 날짜로 바꿀 수 없습니다.');
   const i=n.transactions.findIndex(t=>t.id===obj.id);if(i<0)n.transactions.push(obj);else n.transactions[i]=obj;
  });
  const form=$('#form'),area=$('#card-included');let previous=item?[...coveredIds(s,item)]:null;
  function update(){if(extra){area.innerHTML='<p class="muted">이미 등록한 할부·카드 결제액에 이 금액을 추가합니다.</p>';return;}
   const c=cardCandidates(s,form.elements.debtId.value,form.elements.date.value,item?.id).filter(t=>!s.transactions.some(b=>b.id!==item?.id&&coveredIds(s,b).has(t.id)));
   area.innerHTML='<h3>총액에 포함된 결제 항목</h3><p class="muted">포함된 항목을 체크하세요. 체크한 금액은 청구 총액과 별도로 더하지 않습니다.</p>'+c.map(t=>`<label><input type="checkbox" name="coveredTransactionIds" value="${esc(t.id)}" ${previous===null||previous.includes(t.id)?'checked':''}> ${esc(t.name)} · ${money(t.amount)} · ${t.date}</label>`).join('')+'<p id="covered-summary" class="muted"></p>';summary();}
  function summary(){const ids=[...area.querySelectorAll('input:checked')].map(x=>x.value),sum=s.transactions.filter(t=>ids.includes(t.id)).reduce((n,t)=>n+t.amount,0);const el=$('#covered-summary');if(el)el.textContent='포함 항목 합계 '+money(sum)+' · 청구 총액은 이 합계 이상이어야 합니다.';}
  form.elements.debtId.onchange=()=>{const d=cards.find(d=>d.id===form.elements.debtId.value);if(d.paymentAccountId)form.elements.accountId.value=d.paymentAccountId;previous=null;update();};form.elements.date.onchange=()=>{previous=null;update();};area.onchange=summary;
  form.elements.amount.oninput=()=>{if(!item)form.elements.principalPart.value=form.elements.amount.value;};update();
 }
 $('#card-bill').onclick=()=>bill();$('#card-extra').onclick=()=>bill(null,true);document.querySelectorAll('[data-bill-edit]').forEach(b=>b.onclick=()=>bill(s.transactions.find(t=>t.id===b.dataset.billEdit)));
 $('#card-installments').onclick=()=>{
  if(!cards.length||!accounts.length){edit('debt');return;}
  const d=cards[0];open('금액이 다른 할부 · 남은 회차 등록',input('name','할부 이름','text','','required maxlength="60"')+select('debtId','카드',choices,d.id)+select('accountId','결제 계좌',accounts,d.paymentAccountId||accounts[0][0])+input('firstDate','첫 남은 회차 결제일','date',cardDate(localDate(),d)||dueDate(month,d.paymentDay||15),'required')+input('count','남은 회차 수','number',3,'required min="1" max="120"')+input('defaultAmount','기본 월 결제액 (아래에서 회차별 수정 가능)','number','','min="1" step="1"')+'<button type="button" id="make-installments">회차 입력칸 만들기</button><div id="installment-rows"></div><p class="muted">이미 낸 회차는 제외하고 남은 회차만 입력하세요. 총 결제액에 수수료를 포함하고, 원금은 따로 입력합니다. 사용액까지 기록하려면 카드 구매 기록을 별도로 입력하되 그 구매의 결제 일정은 비워 두세요.</p>',(f,n)=>{
   const rows=[...$('#installment-rows').querySelectorAll('[data-installment-row]')].map((_,i)=>({date:f.get('date'+i),amount:Number(f.get('amount'+i)),principalPart:Number(f.get('principal'+i))}));
   addInstallments(n,{name:f.get('name'),debtId:f.get('debtId'),accountId:f.get('accountId'),rows});
  });
  $('#make-installments').onclick=()=>{const f=$('#form').elements,count=Number(f.count.value),date=f.firstDate.value,amount=f.defaultAmount.value;if(!Number.isInteger(count)||count<1||count>120||!date){$('#form-error').textContent='첫 결제일과 회차 수를 확인하세요.';return;}$('#installment-rows').innerHTML=Array.from({length:count},(_,i)=>`<fieldset data-installment-row><legend>${i+1}회차</legend>${input('date'+i,'결제일','date',dueDate(monthAdd(date.slice(0,7),i),Number(date.slice(8))),'required')}${input('amount'+i,'결제액 (수수료 포함)','number',amount,'required min="1" step="1"')}${input('principal'+i,'원금 (수수료 제외)','number',amount,'required min="0" step="1"')}</fieldset>`).join('');$('#form-error').textContent='';};
  $('#form').elements.debtId.onchange=()=>{const d=cards.find(d=>d.id===$('#form').elements.debtId.value);if(d.paymentAccountId)$('#form').elements.accountId.value=d.paymentAccountId;};
 };
}
