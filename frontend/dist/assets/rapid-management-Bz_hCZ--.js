import{a as e,i as t,n,o as r,r as i,s as a,t as o}from"./index-Dw2dYLjL.js";var s=`Locales`,c={Local:{Pendiente:{next:`Recibido`,label:`RECIBIR`,bgColor:`bg-[#FFF8BC]`},Recibido:{next:`En preparación`,label:`A COCINA`,bgColor:`bg-[#FFF8BC]`},"En preparación":{next:`Terminado`,label:`TERMINAR`,bgColor:`bg-sky-100`},Terminado:{next:`Cobrado`,label:`COBRAR`,bgColor:`bg-teal-100`},Entregado:{next:`Cobrado`,label:`COBRAR`,bgColor:`bg-teal-100`}},Recoger:{Pendiente:{next:`Recibido`,label:`RECIBIR`,bgColor:`bg-[#FFF8BC]`},Recibido:{next:`En preparación`,label:`A COCINA`,bgColor:`bg-[#FFF8BC]`},"En preparación":{next:`Terminado`,label:`TERMINAR`,bgColor:`bg-sky-100`},Terminado:{next:`Cobrado`,label:`COBRAR`,bgColor:`bg-teal-100`},Entregado:{next:`Cobrado`,label:`COBRAR`,bgColor:`bg-teal-100`}},Domicilio:{Pendiente:{next:`Recibido`,label:`RECIBIR`,bgColor:`bg-[#FFF8BC]`},Recibido:{next:`En preparación`,label:`A COCINA`,bgColor:`bg-[#FFF8BC]`},"En preparación":{next:`Terminado`,label:`TERMINAR`,bgColor:`bg-sky-100`},Terminado:{next:`En Reparto`,label:`A REPARTO`,bgColor:`bg-amber-100`},"En Reparto":{next:`Cobrado`,label:`COBRAR`,bgColor:`bg-teal-100`},"En ruta":{next:`Cobrado`,label:`COBRAR`,bgColor:`bg-teal-100`},Entregado:{next:`Cobrado`,label:`COBRAR`,bgColor:`bg-teal-100`}}};window.switchGRTab=f,window.renderRapidManagement=p,window.addEventListener(`orders-updated`,()=>{let e=i(`rapid-management-view`);e&&!e.classList.contains(`hidden`)&&p()}),window.openGRNotes=e=>{window.openViewNotesModal?window.openViewNotesModal(e):window.dispatchEvent(new CustomEvent(`request-open-notes`,{detail:{orderId:e}}))},window.printOrderFromGR=(e,t)=>{let n=[...a.orders||[],...a.waiterOrders||[]].find(t=>t.id==e);n&&o(t?{...n,isWaiterOrder:!0}:n)};function l(){}function u(){let e=i(`rapid-management-view`);e&&(e.classList.remove(`hidden`),p())}function d(){let e=i(`rapid-management-view`);e&&e.classList.add(`hidden`)}function f(e){s=e;let t=i(`btn-gr-tab-locales`),n=i(`btn-gr-tab-generales`);e===`Locales`?(t.className=`gr-tab-btn active flex-1 py-2 rounded-xl text-sm font-bold shadow-xs transition-all cursor-pointer`,n.className=`gr-tab-btn flex-1 py-2 rounded-xl text-sm font-bold shadow-xs transition-all cursor-pointer`):(n.className=`gr-tab-btn active flex-1 py-2 rounded-xl text-sm font-bold shadow-xs transition-all cursor-pointer`,t.className=`gr-tab-btn flex-1 py-2 rounded-xl text-sm font-bold shadow-xs transition-all cursor-pointer`);let r=i(`fab-gr-local`),a=i(`fab-gr-general`);r&&a&&(e===`Locales`?(r.classList.remove(`hidden`),a.classList.add(`hidden`)):(a.classList.remove(`hidden`),r.classList.add(`hidden`))),typeof window.clearOrderNotification==`function`&&window.clearOrderNotification(e===`Locales`?`local`:`general`),p()}function p(){let e=i(`gr-orders-container`),t=i(`gr-header-date`),n=i(`gr-header-admin`);if(t&&(t.textContent=new Date().toLocaleDateString(`es-CO`,{weekday:`long`,year:`numeric`,month:`long`,day:`numeric`})),n&&(n.textContent=a.user?.name||`Administrador`),!e)return;let o={Pendiente:1,Recibido:2,"En preparación":3,Terminado:4,"En Reparto":4.5,Entregado:5,Cobrado:6},c=e=>{let t=new Date(e);return t.setHours(t.getHours()-2),t.toLocaleDateString(`es-CO`)},l=c(new Date),u=[...a.orders||[],...a.waiterOrders||[]].filter(e=>{let t=e.status!==`Anulado`&&e.status!==`Eliminado`&&e.status!==`Cancelado`,n=c(r(e.timestamp||e.date))===l,i=s===`Locales`?e.type===`Local`:e.type!==`Local`;return t&&n&&i}),d=Array.from(new Map(u.map(e=>[e.id,e])).values());d.sort((e,t)=>{let n=o[e.status]||99,r=o[t.status]||99;return n===r?e.id-t.id:n-r}),e.innerHTML=d.map(e=>m(e)).join(``),setTimeout(g,100)}function m(n){let r=n.type===`Local`,i=(n.client||n.customerName||`Cliente General`).toUpperCase(),a;a=r?(n.waiterName||`Staff`).toUpperCase():n.deliveryAddress||n.address||`Recoge en Local`;let o=h(n),s=n.payment===`Transferencia`&&n.proof,c=n.unsolved_notes_count>0?`
        <button onclick="window.openGRNotes('${n.id}')" class="relative group p-1 w-8 h-8 flex-shrink-0 flex items-center justify-center rounded-full transition-colors text-orange-500 hover:text-orange-600 bell-ring-container ml-2 mr-2" title="Ver Notas">
            <div class="bell-pulse-ring"></div>
            <i class="fas fa-bell animate-jump-spin relative z-10 text-lg"></i>
        </button>
    `:`
        <div class="w-8 h-8 flex items-center justify-center text-gray-200 ml-2 mr-2">
            <i class="fas fa-bell text-lg"></i>
        </div>
    `,l=new Date(n.timestamp).toLocaleTimeString(`es-CO`,{timeZone:`America/Bogota`,hour:`2-digit`,minute:`2-digit`}),u=r?`true`:`false`;return`
    <div class="gr-card mx-auto bg-white rounded-[1.2rem] p-2.5 shadow-md relative shrink-0 snap-start border border-gray-100/50 flex mb-4 mr-4 transition-all duration-300" style="width: 320px; height:auto;" id="gr-card-${n.id}">
        
        <!-- Main Content (Left) -->
        <div class="flex-1 flex flex-col justify-between min-w-0 pr-2">
            <!-- Header -->
        <div class="flex items-center justify-between mb-1 bg-gray-50 rounded-[0.8rem] p-1.5 px-3">
            <div class="flex flex-col">
                <span class="text-[9px] text-gray-400 font-bold uppercase tracking-wider leading-none mb-0.5">ID PEDIDO</span>
                <span class="text-xl font-black text-gray-800 leading-none">#${n.id}</span>
            </div>
            
            <div class="flex items-center">
                ${c}
                
                ${n.phone?`
                <button onclick="window.openWhatsApp('${n.id}')"
                    class="text-green-500 mr-[10px] hover:text-green-700 p-1 w-8 h-8 flex items-center justify-center rounded-full hover:bg-green-50 transition-colors"
                    title="Enviar WhatsApp">
                    <i class="fab fa-whatsapp text-[14px]"></i>
                </button>
                `:``}

               ${s?`
                <button onclick="window.showImageModal('${n.proof}')"
                    class="w-8 h-8 bg-gray-700 rounded-full flex items-center justify-center text-white hover:bg-gray-800 transition-all shadow-sm">
                    <i class="fas fa-image text-xs"></i>
                </button>
                `:`
                <div class="w-8 h-8 bg-gray-100 rounded-full flex items-center justify-center text-gray-300">
                    <i class="fas fa-image text-xs"></i>
                </div>
                `}
            </div>
        </div>
        
        <!-- Status (Right Aligned per user edit) -->
        <div class="mb-1 mt-1 flex items-center justify-between">
            <span class="text-xs text-gray-400 font-medium pl-1"><i class="far fa-clock"></i> ${l}</span>
            <div class="flex items-center justify-end">
                <span class="text-[9px] text-gray-400 font-bold uppercase tracking-wider mr-2">Estado:</span>
                <div class="inline-block px-2 py-0.5 rounded-md text-[9px] font-black uppercase bg-gray-100 text-gray-600 shadow-sm truncate max-w-[150px]">
                    ${n.status}
                </div>
            </div>
        </div>

        <!-- Body -->
        <div class="flex-1 min-h-0 flex flex-col gap-0.5">
            <!-- Client -->
            <div>
                 <h3 class="text-sm font-black text-gray-900 leading-tight truncate">${i}</h3>
            </div>
            
            <!-- Address / Secondary -->
            <div class="flex gap-1 overflow-hidden min-h-[1em] items-start mb-1 px-1">
                <i class="fas fa-map-marker-alt text-[9px] text-gray-400 mt-0.5 shrink-0"></i>
                <p class="text-[9px] font-bold text-gray-600 leading-tight line-clamp-2">${a}</p>
            </div>

            <!-- Tips, Discounts & Notes -->
            <div class="flex flex-wrap items-center gap-2 px-1 mb-1 shrink-0 w-full">
                ${parseFloat(n.tip)>0||parseFloat(n.discount)>0?`
                <div class="flex items-center gap-2 text-[10px] bg-gray-50/80 px-2 py-1.5 rounded-lg border border-gray-100/80">
                    ${parseFloat(n.tip)>0?`<span class="text-green-600 font-bold" title="Propina"><i class="fas fa-coins mr-1"></i>+${e(n.tip)}</span>`:``}
                    ${parseFloat(n.discount)>0?`<span class="text-red-500 font-bold" title="Descuento"><i class="fas fa-tag mr-1"></i>-${e(n.discount)}</span>`:``}
                </div>
                `:``}
                ${n.notes&&n.notes.trim()!==``?`
                <div class="text-[10px] text-gray-500 bg-orange-50/50 px-2 py-1.5 rounded-lg border border-orange-100/50 flex-1 min-w-[100px] truncate italic w-full">
                    <i class="fas fa-sticky-note mr-1 text-orange-400"></i> <span title="${t(n.notes)}">${t(n.notes)}</span>
                </div>
                `:``}
            </div>

            <!-- Bottom Row: Extra Info + Total -->
            <div class="flex items-end justify-between gap-2 overflow-hidden shrink-0 px-1 mt-0.5">
                <!-- Extra Info (Left) -->
                <div class="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[10px] text-gray-500 font-medium leading-none flex-1">
                    <div class="flex items-center gap-1">
                         <i class="${r?`fas fa-chair`:`fas fa-motorcycle`} text-gray-400"></i>
                         <span>${n.type}</span>
                    </div>
                    <div class="flex items-center gap-1">
                         <i class="fas fa-money-bill-wave text-gray-400"></i>
                         <span>${n.payment}</span>
                    </div>
                    ${r?`
                    <div class="flex items-center gap-1 text-gray-600">
                        <i class="fas fa-table text-gray-400 gap-1"></i>
                        <span class="font-bold text-[10px]">Mesa ${n.table||`?`}</span>
                    </div>
                    `:`
                    <div class="flex items-center gap-1 text-gray-600">
                        <i class="fas fa-user-astronaut text-gray-400"></i>
                        <span class="font-bold text-[10px] truncate max-w-[80px]" title="${n.deliveryDriverName||`Sin Domiciliario`}">${n.deliveryDriverName||`Sin Dom...`}</span>
                    </div>
                    `}
                </div>

                <!-- Total (Right) -->
                 <div class="text-right shrink-0">
                    <p class="text-lg font-black text-gray-900 leading-none tracking-tight">${e(n.total)}</p>
                </div>
            </div>
        </div>

            <!-- Footer: Slider -->
            <div class="mt-1 h-9 shrink-0">
                ${o}
            </div>
        </div>

        <!-- Actions Column (Right) -->
        <div class="flex flex-col gap-2 justify-center items-center border-l border-gray-100 pl-2 shrink-0">
            <button onclick="window.showOrderDetails('${n.id}')" class="text-blue-500 hover:text-blue-700 p-2 rounded-full hover:bg-blue-50 transition-colors" title="Ver Detalles">
                <i class="fas fa-eye text-[14px]"></i>
            </button>
            <button onclick="window.printOrderFromGR('${n.id}', ${u})" class="text-gray-600 hover:text-gray-900 p-2 rounded-full hover:bg-gray-50 transition-colors" title="Imprimir Ticket">
                <i class="fas fa-file-invoice text-[14px]"></i>
            </button>
            <button onclick="if(window.openOrderEditModal) window.openOrderEditModal('${n.id}', ${u})" class="text-blue-500 hover:text-blue-700 p-2 rounded-full hover:bg-blue-50 transition-colors" title="Editar Pedido">
                <i class="fas fa-edit text-[14px]"></i>
            </button>
            <button onclick="window.promptCancelOrder('${n.id}')" class="text-red-500 hover:text-red-700 p-2 rounded-full hover:bg-red-50 transition-colors" title="Anular Pedido">
                <i class="fas fa-trash-alt text-[14px]"></i>
            </button>
        </div>
    </div>
        `}function h(e){let t=e.status;if(t===`Cobrado`)return`
        <div class="w-full h-10 bg-gray-100 rounded-[0.8rem] flex items-center justify-center border border-gray-200">
            <span class="font-bold text-gray-400 uppercase tracking-widest text-[10px]">COBRADO</span>
        </div>`;let n=c[e.type]?.[t];if(!n)return`
        <div class="w-full h-10 bg-gray-50 rounded-[0.8rem] flex items-center justify-center border border-gray-200">
            <span class="font-bold text-gray-400 uppercase tracking-widest text-[10px]">${t.toUpperCase()}</span>
        </div>`;let{next:r,label:i,bgColor:a}=n;return`
        <div class="gr-slider-container relative w-full h-10 ${a} rounded-[0.8rem] flex items-center overflow-hidden cursor-pointer select-none shadow-sm active:scale-[0.99] group"
    data-status="${t}" data-next-status="${r}" data-loading="false">
         
         <div class="gr-slider-track absolute left-0 top-0 bottom-0 bg-black/5 w-0"></div>

         <div class="absolute inset-0 flex items-center justify-center pointer-events-none z-0">
            <span class="font-black text-gray-800 uppercase tracking-wide text-[10px] gr-slider-label opacity-80">${i}</span>
         </div>
         
         <!-- Handle -->
         <div class="gr-slider-handle absolute left-1 w-8 h-8 bg-white rounded-full shadow-md flex items-center justify-center z-10 border border-black/5">
            <i class="fas fa-arrow-right text-gray-900 text-[10px]"></i>
         </div>
         
         <div class="gr-slider-success absolute inset-0 bg-emerald-500 z-20 flex items-center justify-center opacity-0 pointer-events-none transition-opacity duration-300">
            <i class="fas fa-check text-white text-lg"></i>
         </div>
    </div>
        `}function g(){document.querySelectorAll(`.gr-slider-container`).forEach(e=>{let t=e.querySelector(`.gr-slider-handle`),n=e.querySelector(`.gr-slider-track`),r=e.querySelector(`.gr-slider-label`),i=e.querySelector(`.gr-slider-success`),a=!1,o=0,s=e.offsetWidth-t.offsetWidth-8,c=n=>{e.dataset.loading!==`true`&&(a=!0,o=n.type.includes(`touch`)?n.touches[0].clientX:n.clientX,t.style.transition=`none`)},l=e=>{if(!a)return;let i=(e.type.includes(`touch`)?e.touches[0].clientX:e.clientX)-o;i=Math.max(0,Math.min(i,s)),t.style.transform=`translateX(${i}px)`,n.style.width=`${i+t.offsetWidth/2} px`,r.style.opacity=1-i/(s*.8)},u=o=>{if(!a)return;a=!1;let c=new WebKitCSSMatrix(window.getComputedStyle(t).transform).m41;t.style.transition=`all 0.3s cubic-bezier(0.4, 0, 0.2, 1)`,n.style.transition=`all 0.3s cubic-bezier(0.4, 0, 0.2, 1)`,c>s*.85?(t.style.transform=`translateX(${s}px)`,i.style.opacity=`1`,_(e)):(t.style.transform=`translateX(0)`,n.style.width=`0`,r.style.opacity=`0.8`)};t.addEventListener(`mousedown`,c),t.addEventListener(`touchstart`,c),window.addEventListener(`mousemove`,e=>a&&l(e)),window.addEventListener(`touchmove`,e=>a&&l(e)),window.addEventListener(`mouseup`,e=>a&&u(e)),window.addEventListener(`touchend`,e=>a&&u(e))})}window.openOrderCobro=async e=>{let t=typeof e==`object`&&e?e:null;if(t||=(a.orders||[]).find(t=>t.id==e)||(a.waiterOrders||[]).find(t=>t.id==e),!t&&typeof e!=`object`&&window.OfflineDB)try{t=await window.OfflineDB.getOfflineOrder(e)}catch{}if(!t&&typeof e!=`object`&&navigator.onLine&&window.ApiClient)try{let n=await window.ApiClient.get(`/orders/${e}`);t=n?.order||n}catch{}t&&window.openPaymentModal&&window.openPaymentModal(t,()=>{window.renderRapidManagement&&window.renderRapidManagement(),window.reloadAdminData&&window.reloadAdminData()})};function _(e){let t=e.closest(`.gr-card`),r=t.id.replace(`gr-card-`,``),i=e.dataset.nextStatus;if(!i){console.error(`No next status defined`),y(e);return}if(i===`Cobrado`){y(e),window.openOrderCobro&&window.openOrderCobro(r);return}e.dataset.loading=`true`,console.log(`GR: Updating #${r} to ${i}`);let o=(a.orders||[]).find(e=>e.id==r),s=(a.waiterOrders||[]).find(e=>e.id==r),c=(o||s)?.status,l=(a.orders||[]).findIndex(e=>e.id==r);l!==-1&&(a.orders[l].status=i);let u=(a.waiterOrders||[]).findIndex(e=>e.id==r);u!==-1&&(a.waiterOrders[u].status=i);let d=l===-1?u===-1?null:a.waiterOrders[u]:a.orders[l];if(d&&t&&t.parentNode){let e=m(d),n=document.createElement(`div`);n.innerHTML=e;let r=n.firstElementChild;t.parentNode.replaceChild(r,t);let i=r.querySelector(`.gr-slider-container`);i&&v(i)}n(r,{status:i}).catch(e=>{console.error(e),l!==-1&&c&&(a.orders[l].status=c),u!==-1&&c&&(a.waiterOrders[u].status=c),p()})}function v(e){let t=e.querySelector(`.gr-slider-handle`),n=e.querySelector(`.gr-slider-track`),r=e.querySelector(`.gr-slider-label`),i=e.querySelector(`.gr-slider-success`),a=!1,o=0,s=e.offsetWidth-t.offsetWidth-8,c=n=>{e.dataset.loading!==`true`&&(a=!0,o=n.type.includes(`touch`)?n.touches[0].clientX:n.clientX,t.style.transition=`none`)},l=e=>{if(!a)return;let i=(e.type.includes(`touch`)?e.touches[0].clientX:e.clientX)-o;i=Math.max(0,Math.min(i,s)),t.style.transform=`translateX(${i}px)`,n.style.width=`${i+t.offsetWidth/2} px`,r.style.opacity=1-i/(s*.8)},u=o=>{if(!a)return;a=!1;let c=new WebKitCSSMatrix(window.getComputedStyle(t).transform).m41;t.style.transition=`all 0.3s cubic-bezier(0.4, 0, 0.2, 1)`,n.style.transition=`all 0.3s cubic-bezier(0.4, 0, 0.2, 1)`,c>s*.85?(t.style.transform=`translateX(${s}px)`,i.style.opacity=`1`,_(e)):(t.style.transform=`translateX(0)`,n.style.width=`0`,r.style.opacity=`0.8`)};t.addEventListener(`mousedown`,c),t.addEventListener(`touchstart`,c),window.addEventListener(`mousemove`,e=>a&&l(e)),window.addEventListener(`touchmove`,e=>a&&l(e)),window.addEventListener(`mouseup`,e=>a&&u(e)),window.addEventListener(`touchend`,e=>a&&u(e))}function y(e){e.dataset.loading=`false`;let t=e.querySelector(`.gr-slider-handle`),n=e.querySelector(`.gr-slider-track`),r=e.querySelector(`.gr-slider-label`),i=e.querySelector(`.gr-slider-success`);t&&(t.style.transform=`translateX(0)`),n&&(n.style.width=`0`),r&&(r.style.opacity=`0.8`),i&&(i.style.opacity=`0`)}export{d as closeRapidManagement,l as initRapidManagement,u as openRapidManagement};