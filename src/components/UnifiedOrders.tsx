import React, { useEffect, useState } from 'react';
import { endOffers, setLastOffers, resumeLastOffers, refundPaymentItems, hasOrderRefund, createCommissionRefund, hasCommissionClaim } from '../apiAllegro';
import { setWooOne, endWooProduct, resumeWooProduct, fetchWooOrderNotes } from '../apiWoo';
import type { Order } from '../apiAllegro';

export interface UnifiedOrder extends Partial<Order> {
  // Wspólne pola
  id: string;
  platform: 'A' | 'W';
  storeLabel: string; // login allegro lub nazwa sklepu Woo
  source: 'allegro' | 'woo';
  wooStore?: 'outdoorowe' | 'sklepbastion';
  createdAt: string;
  status?: string;
  items: any[]; // Order.items kompatybilne
  totalAmount?: number;
  currency?: string;
  buyer?: string;
  buyerFullName?: string;
  buyerLogin?: string; // jawnie pobrany login Allegro (lub Woo buyer string)
  buyerFirstName?: string;
  buyerLastName?: string;
  // Pre-renderowane etykiety wyświetlane na karcie (by uniknąć "migania")
  buyerLabelBold?: string;
  buyerLabelPlain?: string;
  buyerNote?: string;
  sellerNote?: string;
  isPaid?: boolean;
  hasInvoice?: boolean;
  deliveryMethod?: string;
  // Nowe pola z Allegro (opcjonalne)
  buyerEmail?: string;
  buyerPhone?: string;
  buyerAddressStreet?: string;
  buyerAddressCity?: string;
  buyerAddressPostCode?: string;
  deliveryFirstName?: string;
  deliveryLastName?: string;
  deliveryStreet?: string;
  deliveryCity?: string;
  deliveryPostCode?: string;
  deliveryPhone?: string;
  paymentType?: string;
  paymentFinishedAt?: string;
  // Dodatkowe pola pomocnicze (nie zawsze obecne)
  billing?: any; // Woo billing (address_1, address_2, city, postcode, phone)
  // Gdy dostępny pełny obiekt buyer z Allegro (address, phoneNumber, login)
  buyerObject?: any;
}

interface Props {
  orders: UnifiedOrder[];
  formatDate: (s: string) => string;
  formatWithPln: (amount?: number, currency?: string) => string;
  simplifyDeliveryMethod: (s?: string) => string;
  openModalImage: (src?: string, offerId?: string, model?: string) => void;
  handleSetProcessing: (orderId: string) => void | Promise<void>;
  updating: Set<string>;
  refresh: () => Promise<void>;
  onDownloadReceipt?: (order: UnifiedOrder) => void;
  getWooAdminUrl?: (store: string | undefined, orderId: string) => string | undefined;
  onDownloadReceiptWoo?: (order: UnifiedOrder) => void;
  returnedOfferIds?: Set<string>;
  returnedOrderIds?: Set<string>;
  // Nowe: per-zamówienie lista zwróconych offerId (tylko Allegro)
  returnedOfferIdsByOrder?: Record<string, Set<string> | string[]>;
  // Nowe: data złożenia zwrotu per zamówienie (najwcześniejsza), do pokazania obok daty zamówienia
  returnDateByOrderId?: Record<string, string>;
  // NOWE: numer zwrotu (referenceNumber) per orderId
  returnReferenceByOrderId?: Record<string, string>;
}

const UnifiedOrders: React.FC<Props> = ({ orders, formatDate, formatWithPln, simplifyDeliveryMethod, openModalImage, handleSetProcessing, updating, refresh, onDownloadReceipt, getWooAdminUrl, onDownloadReceiptWoo, returnedOfferIds, returnedOrderIds, returnedOfferIdsByOrder, returnDateByOrderId, returnReferenceByOrderId }) => {
  const [refundWorking, setRefundWorking] = useState<string | null>(null);
  const [refundStatus, setRefundStatus] = useState<Record<string, boolean>>({});
  const [commissionWorking, setCommissionWorking] = useState<string | null>(null);
  const [commissionStatus, setCommissionStatus] = useState<Record<string, boolean>>({});
  const [wooNotesCache, setWooNotesCache] = useState<Record<string, { loading: boolean; sellerNote?: string; sellerNoteAuthor?: string; sellerNotes?: { text: string; author?: string; id: number; date?: string; }[]; raw?: any[]; showRaw?: boolean }>>({});

  // Formatowanie imienia i nazwiska: każda część (także po myślniku) z dużej litery
  const formatPersonName = (input?: string): string | undefined => {
    if (!input) return input;
    return input
      .trim()
      .split(/\s+/)
      .map(part => part
        .split('-')
        .map(seg => seg ? seg.charAt(0).toLocaleUpperCase('pl-PL') + seg.slice(1).toLocaleLowerCase('pl-PL') : seg)
        .join('-')
      )
      .join(' ');
  };

  // Auto-pobieranie notatek Woo (bez przycisku). Reguła: dowolna notatka z autorem różnym od 'WooCommerce'.
  useEffect(() => {
    const wooOrders = orders.filter(o => o.platform === 'W');
    if (!wooOrders.length) return;
    let cancelled = false;
    const toFetch = wooOrders.filter(o => {
      const key = o.id + ':' + (o.wooStore||'');
      const entry = wooNotesCache[key];
      return !entry; // brak wpisu -> pobierz
    });
    if (!toFetch.length) return;
    const CONCURRENCY = 4;
    const queue = [...toFetch];
    const runWorker = async () => {
      while (!cancelled && queue.length) {
        const ord = queue.shift();
        if (!ord) break;
        const key = ord.id + ':' + (ord.wooStore||'');
        setWooNotesCache(prev => ({ ...prev, [key]: { ...(prev[key]||{}), loading: true } }));
        try {
          const notes = await fetchWooOrderNotes(ord.wooStore||'', ord.id);
          // Wybierz notatkę użytkownika: author/name/user != 'WooCommerce'
          const manual = notes
            .filter(n => {
              const author = (n.author || n.name || n.user || '').toString().trim();
              if (!author || author.toLowerCase() === 'woocommerce') return false;
              const text = String(n.note||'').trim();
              return !!text;
            })
            .sort((a,b)=> new Date(a.date_created||0).getTime() - new Date(b.date_created||0).getTime()); // rosnąco – by wyświetlić w kolejności dodania
          if (manual.length) {
            const prepared = manual.map(n => ({
              id: n.id,
              author: (n.author || n.name || n.user || undefined),
              date: n.date_created,
              text: String(n.note).replace(/<[^>]+>/g,'').trim()
            })).filter(x => x.text);
            setWooNotesCache(prev => ({ ...prev, [key]: { loading: false, sellerNotes: prepared, sellerNote: prepared[prepared.length-1]?.text, sellerNoteAuthor: prepared[prepared.length-1]?.author, raw: notes } }));
          } else {
            setWooNotesCache(prev => ({ ...prev, [key]: { loading: false, raw: notes } }));
          }
        } catch (e) {
          console.error('Auto Woo notes error', e);
          setWooNotesCache(prev => ({ ...prev, [key]: { loading: false } }));
        }
      }
    };
    const workers = Array.from({ length: Math.min(CONCURRENCY, queue.length) }, () => runWorker());
    Promise.all(workers).catch(()=>{});
    return () => { cancelled = true; };
  }, [orders]);

  // Sprawdź, czy zamówienia Allegro (oznaczone zwrotem) mają już wykonany zwrot płatności
  useEffect(() => {
    // debounce minimalny, żeby uniknąć dwóch szybkich przebiegów po merge'u
    const t = setTimeout(() => {
      const idsToCheck = orders
        .filter(o => o.platform==='A' && (returnedOrderIds?.has(o.id) || false))
        .map(o => o.id)
        .filter(id => refundStatus[id] === undefined);
      if (!idsToCheck.length) return;
      let cancelled = false;
      const concurrency = 6; // limit współbieżności
      const chunk = (arr: string[], size: number) => {
        const out: string[][] = [];
        for (let i=0;i<arr.length;i+=size) out.push(arr.slice(i, i+size));
        return out;
      };
      (async () => {
        for (const batch of chunk(idsToCheck, concurrency)) {
          if (cancelled) break;
          try {
            const results = await Promise.all(batch.map(async (id) => {
              try { const has = await hasOrderRefund(id); return { id, has: !!has }; }
              catch { return { id, has: false }; }
            }));
            if (!cancelled) {
              setRefundStatus(prev => {
                const next = { ...prev } as Record<string, boolean>;
                results.forEach(r => { next[r.id] = r.has; });
                return next;
              });
            }
          } finally {
            // krótka pauza, by nie zalewać przeglądarki
            await new Promise(r => setTimeout(r, 50));
          }
        }
      })();
      return () => { cancelled = true; };
    }, 50);
    return () => clearTimeout(t);
  }, [orders, returnedOrderIds]);

  // Sprawdź, czy zamówienia Allegro (oznaczone zwrotem) mają już zgłoszony zwrot prowizji
  useEffect(() => {
    const t = setTimeout(() => {
      const idsToCheck = orders
        .filter(o => o.platform==='A' && (returnedOrderIds?.has(o.id) || false))
        .map(o => o.id)
        .filter(id => commissionStatus[id] === undefined);
      if (!idsToCheck.length) return;
      let cancelled = false;
      const concurrency = 6;
      const chunk = (arr: string[], size: number) => {
        const out: string[][] = [];
        for (let i=0;i<arr.length;i+=size) out.push(arr.slice(i, i+size));
        return out;
      };
      (async () => {
        for (const batch of chunk(idsToCheck, concurrency)) {
          if (cancelled) break;
          try {
            const results = await Promise.all(batch.map(async (id) => {
              try { const has = await hasCommissionClaim(id); return { id, has: !!has }; }
              catch { return { id, has: false }; }
            }));
            if (!cancelled) {
              setCommissionStatus(prev => {
                const next = { ...prev } as Record<string, boolean>;
                results.forEach(r => { next[r.id] = r.has; });
                return next;
              });
            }
          } finally {
            await new Promise(r => setTimeout(r, 50));
          }
        }
      })();
      return () => { cancelled = true; };
    }, 50);
    return () => clearTimeout(t);
  }, [orders, returnedOrderIds]);
  return (
    <div className="row g-3 mt-0">
      {orders.map(order => {
        const offerIds = (order.items || []).filter((it: any) => !it.isShipping && it.id).map((it: any) => it.id);
        // Ujednolicone, odporne na brak danych – obiekt kupującego może być w buyerObject albo buyer
        const buyerObj: any = (order as any).buyerObject || ((order as any).buyer && typeof (order as any).buyer === 'object' ? (order as any).buyer : null);
        const computedFullName = (() => {
          // Priorytet: jawnie policzona buyerFullName, ale jeśli pusta – przelicz z obiektu
          let full = (typeof order.buyerFullName === 'string' && order.buyerFullName.trim()) ? order.buyerFullName.trim() : undefined;
          if (!full) {
            const fnA = buyerObj?.firstName || buyerObj?.first_name;
            const lnA = buyerObj?.lastName || buyerObj?.last_name;
            const billing: any = (order as any).billing || {};
            const fnW = billing.first_name || billing.firstName;
            const lnW = billing.last_name || billing.lastName;
            const fn = fnA || fnW;
            const ln = lnA || lnW;
            const parts = [fn, ln].filter(Boolean);
            if (parts.length) full = parts.join(' ');
          }
          if (full) full = formatPersonName(full);
          return full;
        })();
        // Preferuj pre-renderowane etykiety jeśli są (unikamy migania)
        let boldBuyerPart: string | undefined = order.buyerLabelBold;
        let plainNamePart: string | undefined = order.buyerLabelPlain;
        if (!boldBuyerPart) {
          // Fallback do logiki runtime tylko gdy brak etykiet
          const allegroLogin = order.platform === 'A'
            ? ((order as any).buyerLogin || (typeof order.buyer === 'string' ? order.buyer : '') || '')
            : '';
          if (order.platform === 'A') {
            boldBuyerPart = allegroLogin || '(brak loginu)';
            const fn = order.buyerFirstName || buyerObj?.firstName || buyerObj?.first_name || '';
            const ln = order.buyerLastName || buyerObj?.lastName || buyerObj?.last_name || '';
            const joined = [fn, ln].filter(Boolean).join(' ').trim();
            if (joined && joined !== allegroLogin) {
              plainNamePart = formatPersonName(joined) || joined;
            } else if (computedFullName && computedFullName !== allegroLogin) {
              plainNamePart = computedFullName;
            }
            if (!plainNamePart && buyerObj && (buyerObj.firstName || buyerObj.lastName)) {
              const fallbackJoined = [buyerObj.firstName, buyerObj.lastName].filter(Boolean).join(' ').trim();
              if (fallbackJoined && fallbackJoined !== allegroLogin) plainNamePart = formatPersonName(fallbackJoined) || fallbackJoined;
            }
          } else {
            boldBuyerPart = (order.buyer || order.id || '(brak)');
            if (computedFullName && computedFullName !== boldBuyerPart) {
              plainNamePart = formatPersonName(computedFullName) || computedFullName;
            }
          }
        }
        if (plainNamePart) plainNamePart = formatPersonName(plainNamePart) || plainNamePart;
        const buildTooltip = () => {
          try {
            const lines: string[] = [];
            lines.push(`ID Zamówienia: \n  ${order.id}`);
            if (order.platform === 'A') {
              const login = (order as any).buyerLogin || (typeof order.buyer === 'string' ? order.buyer : '') || '';
              lines.push(`Nazwa użytkownika: \n  ${login || '(brak)'}`);
            }
            const fullName = (computedFullName || '').trim();
            lines.push(`Imię i Nazwisko: \n  ${fullName || '(brak)'}`);
            let phone: string | undefined = order.platform === 'A'
              ? ((order as any).buyerPhone || buyerObj?.phoneNumber || (order as any).deliveryPhone || (order as any).invoicePhone)
              : (order as any).billing?.phone;
            lines.push(`Telefon: \n  ${phone || '(brak)'}`);
            const addrLines: string[] = [];
            if (order.platform === 'A') {
              // Preferuj adres dostawy (delivery), a w razie braku adres konta kupującego
              const delPost = (order as any).deliveryPostCode;
              const delCity = (order as any).deliveryCity;
              const delStreet = (order as any).deliveryStreet;
              const sourceAddr = (!delPost && !delCity && !delStreet) ? (buyerObj?.address || (order as any).buyer?.address || {}) : {};
              const postCode = delPost || sourceAddr.postCode || sourceAddr.post_code || '';
              const city = delCity || sourceAddr.city || '';
              const street = delStreet || sourceAddr.street || '';
              if (postCode || city) addrLines.push(`${postCode} ${city}`.trim());
              if (street) addrLines.push(street); else if (!(postCode||city)) addrLines.push('(brak adresu)');
            } else {
              const billing = (order as any).billing || {};
              const postCode = billing.postcode || billing.post_code || '';
              const city = billing.city || '';
              const street = billing.address_1 || '';
              const nr = billing.address_2 || '';
              if (postCode || city) addrLines.push(`${postCode} ${city}`.trim());
              const streetLine = [street, nr].filter(Boolean).join(' ');
              if (streetLine) addrLines.push(streetLine); else if (!(postCode||city)) addrLines.push('(brak adresu)');
            }
            lines.push('Adres:');
            if (!addrLines.length) addrLines.push('(brak)');
            addrLines.forEach(l => lines.push('  ' + l));
            return lines.join('\n');
          } catch { return ''; }
        };
        return (
          <div className="order-col" key={order.id + '-' + order.platform} data-offer-ids={offerIds.join(',')} data-platform={order.platform} data-order-id={order.id}>
            <div className="card order-card h-100" >
              <div className="card-body d-flex flex-column gap-2">
                <div className="d-flex justify-content-between align-items-start gap-2 position-relative" style={{width:'100%'}}>
                  <div className="d-flex flex-column" style={{maxWidth:'50%'}}>
                    <span className="small text-secondary" title={buildTooltip()} style={{whiteSpace:'nowrap', textShadow: order.platform==='A' ? '0 2px 3px #ff9e6aff':'0 2px 3px #6aa6ff'}}>
                      <span style={{fontWeight:'bold', color: order.platform==='A' ? '#ff5a00':'#0073aa'}}>{order.platform}</span>
                      <span> {order.storeLabel.toUpperCase()}</span>
                        {(() => {
                        let href: string | null = null;
                        if (order.platform === 'A') {
                          href = `https://salescenter.allegro.com/orders/${encodeURIComponent(order.id)}`;
                        } else if (order.platform === 'W') {
                          const base = order.wooStore === 'sklepbastion' ? 'https://sklepbastion.pl' : 'https://outdoorowe.pl';
                          href = `${base}/wp-admin/post.php?post=${encodeURIComponent(order.id)}&action=edit`;
                        }
                        if (!href) return null;
                        return (
                          <a
                            href={href}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="offer-action-btn primary"
                            style={{ padding:'2px 8px', fontSize:11, lineHeight:1.1, textDecoration:'none', textShadow:'none', position:'relative', top:'-2px', marginLeft:4 }}
                            title="Otwórz szczegóły zamówienia (możesz tam dodać notatkę)"
                          >
                            <span className="icon-emoji" aria-hidden="true">🛒</span>
                          </a>
                        );
                      })()}
                    </span>
                    <span className="small text-muted d-flex align-items-center gap-1 flex-wrap" style={{lineHeight:1}} title={buildTooltip()}>
                      <span className="fw-semibold" style={{whiteSpace:'nowrap'}}>{boldBuyerPart}</span>
                      {plainNamePart && <span style={{whiteSpace:'nowrap'}}>{plainNamePart}</span>}
                    </span>
                  </div>
                  <div className="d-flex flex-column align-items-end" style={{minWidth:140}}>
                    <div className="d-flex align-items-center gap-2">
                      {order.platform==='A' && order.status === 'NEW' && (
                        <button style={{ width:125, fontSize:12, padding:0 }} className="btn btn-outline-warning" onClick={() => handleSetProcessing(order.id)} disabled={updating.has(order.id)}>{updating.has(order.id) ? '...' : 'Ustaw "W realizacji"'}</button>
                      )}
                      {(() => {
                        const isReturned = order.platform==='A' && (returnedOrderIds?.has(order.id) || false);
                        const isSent = order.status === 'SENT';
                          if (isReturned && isSent) {
                            const smallBtnStyle: React.CSSProperties = { padding: '2px 6px', fontSize: 11, lineHeight: 1.1 };
                            return (
                              <span style={{whiteSpace:'nowrap', display:'inline-flex', alignItems:'center', gap:4}}>
                                <button
                                  className={`offer-action-btn primary refund-action ${refundStatus[order.id] === true ? 'refund-done' : ''}`}
                                  style={smallBtnStyle}
                                  title={refundStatus[order.id] ? 'Zwrot wpłaty (zrobiony)' : 'Zwrot wpłaty'}
                                  disabled={(refundStatus[order.id] === true) || (refundWorking === order.id)}
                                  onClick={async (e)=>{
                                    e.stopPropagation?.();
                                    if (refundWorking || refundStatus[order.id]) return;
                                    const ok = window.confirm('Zlecić zwrot wpłaty za pozycje zgłoszone do zwrotu w tym zamówieniu? (bez kosztów wysyłki i dopłat)');
                                    if (!ok) return;
                                    try {
                                      setRefundWorking(order.id);
                                      await refundPaymentItems(order.id, 'REFUND');
                                      setRefundStatus(prev => ({ ...prev, [order.id]: true }));
                                      await refresh();
                                    } catch (err) {
                                      console.error('Refund payment failed', err);
                                      alert('Nie udało się zlecić zwrotu płatności. Szczegóły w konsoli.');
                                    } finally {
                                      setRefundWorking(null);
                                    }
                                  }}
                                >
                                  <span className="icon-emoji">💱</span>
                                </button>
                                <button
                                  className={`offer-action-btn danger refund-action ${commissionStatus[order.id] ? 'refund-done' : ''}`}
                                  style={smallBtnStyle}
                                  title={commissionStatus[order.id] ? 'Zwrot prowizji (zrobiony)' : 'Zwrot prowizji'}
                                  disabled={(commissionStatus[order.id] === true) || (commissionWorking === order.id)}
                                  onClick={async (e)=>{
                                    e.stopPropagation?.();
                                    if (commissionWorking || commissionStatus[order.id]) return;
                                    const ok = window.confirm('Zgłosić zwrot prowizji dla pozycji zwróconych w tym zamówieniu?');
                                    if (!ok) return;
                                    try {
                                      setCommissionWorking(order.id);
                                      await createCommissionRefund(order.id, 'CUSTOMER_RETURN');
                                      setCommissionStatus(prev => ({ ...prev, [order.id]: true }));
                                      await refresh();
                                    } catch (err) {
                                      console.error('Refund commission failed', err);
                                      alert('Nie udało się zgłosić zwrotu prowizji. Szczegóły w konsoli.');
                                    } finally {
                                      setCommissionWorking(null);
                                    }
                                  }}
                                >
                                  <span className="icon-emoji">🥀</span>
                                </button>
                                <span title="Do tego zamówienia został zgłoszony zwrot" style={{ color:'#b00020', fontWeight:600, marginLeft:2, marginRight:4 }}>
                                  {(() => {
                                    const ref = returnReferenceByOrderId?.[order.id];
                                    if (!ref) return 'Zwrot';
                                    // Ucinamy wszystko po pierwszym ukośniku (np. RK2Y/2025 -> RK2Y)
                                    const shortRef = ref.split('/')?.[0] || ref;
                                    return `Zwrot ${shortRef}`;
                                  })()}
                                </span>
                                <span title="Status zamówienia" className={statusClass('SENT')}>Wysłane</span>
                              </span>
                            );
                        }
                        return (
                          <span title="Status zamówienia" className={statusClass(order.status)} style={{whiteSpace:'nowrap'}}>
                            {statusLabel(order.status)}
                          </span>
                        );
                      })()}
                    </div>
                    <span className="text-muted small d-flex align-items-center gap-1" style={{lineHeight:1}}>
                      {order.platform==='A' && (returnedOrderIds?.has(order.id) || false) && returnDateByOrderId?.[order.id] && (
                        <span style={{ color:'#b00020', fontWeight:600, marginRight:'6px' }} title="Data zgłoszenia zwrotu">{formatDate(returnDateByOrderId[order.id])}</span>
                      )}
                      <span title="Data złożenia zamówienia">{formatDate(order.createdAt)}</span>
                    </span>
                  </div>
                </div>
                <div className="d-flex flex-column gap-2">
          {(order.items && order.items.length ? order.items : [{ placeholder:true, name:'(brak pozycji)', quantity:0 }]).map((item: any, idx: number) => (
                    <div key={idx} className="d-flex align-items-center gap-2">
                      {item.isShipping ? (
                        <div style={{ width:48, height:48, display:'flex', alignItems:'center', justifyContent:'center', fontSize:24 }}>🚚</div>
            ) : (item.image ? <img src={item.image} alt={item.name || 'Produkt'} loading="lazy" style={{ width:48, height:48, objectFit:'cover', borderRadius:4, background:'#f5f5f5', cursor:'zoom-in' }} title="Kliknij, aby powiększyć" onClick={() => openModalImage(item.image, item.id, item.model)} /> : <div style={{ width:48, height:48, display:'flex', alignItems:'center', justifyContent:'center', fontSize:20, background:'#f5f5f5', borderRadius:4 }}>📦</div>)}
                      <div className="d-flex flex-column flex-grow-1">
                        <div className="d-flex align-items-start justify-content-between" style={{gap:8}}>
                          {(() => {
                            const perOrder = (order.platform==='A' && returnedOfferIdsByOrder) ? returnedOfferIdsByOrder[order.id] : undefined;
                            const inThisOrder = !!(perOrder && item.id && (perOrder instanceof Set ? perOrder.has(item.id) : Array.isArray(perOrder) ? perOrder.includes(item.id) : false));
                            const isReturnedTitle = (order.platform==='A' && !item.isShipping && inThisOrder);
                            const titleStyle: React.CSSProperties = isReturnedTitle ? {
                              textDecoration: 'underline',
                              textDecorationColor: 'red',
                              textDecorationThickness: '2px',
                              textUnderlineOffset: '2px',
                              color: '#b00020'
                            } : {};
                            const titleClass = 'small fw-medium' + (isReturnedTitle ? ' returned-item-title' : '');
                            const matchType = inThisOrder ? 'offer' : 'none';
                            return (
                              <span className={titleClass} style={{lineHeight:1.2, ...titleStyle}} data-offer-id={item.id || undefined} data-returned={isReturnedTitle ? 'true' : 'false'} data-return-match={matchType}>
                                {item.name || 'Produkt'}
                              </span>
                            );
                          })()}
                          {order.platform==='A' && !item.isShipping && item.id && (
                            <InlineOfferButtons offerId={item.id} itemName={item.name} refresh={refresh} />
                          )}
              {order.platform==='W' && !item.isShipping && item.productId && (
                            <InlineWooButtons
                              store={order.wooStore as any}
                              productId={item.productId}
                              variationId={item.variationId}
                itemName={item.name}
                              refresh={refresh}
                            />
                          )}
                        </div>
                        {item.unitPrice !== undefined && (
                          <span className="text-muted small" style={{lineHeight:1.2}}>{item.quantity > 1 ? `${item.quantity} × ${formatWithPln(item.unitPrice, item.currency)} = ` : ''}{formatWithPln(item.totalPrice, item.currency)}</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
                {(order.buyerNote || order.sellerNote || (() => {
                  // Spróbuj dołączyć sellerNote z cache jeśli nie ma w order
                  if (order.platform==='W') {
                    const key = order.id + ':' + (order.wooStore||'');
                    const c = wooNotesCache[key];
                    return c?.sellerNote;
                  }
                  return undefined;
                })()) && (
                  <div className="d-flex flex-column gap-1 small" style={{lineHeight:1.15}}>
                    {order.buyerNote && <div className="text-muted" style={{wordBreak:'break-word'}}><span className="text-secondary fw-bold">📑Notatka klienta:</span> {order.buyerNote}</div>}
                    {(() => {
                      const injected = (() => {
                        if (order.platform==='W' && !order.sellerNote) {
                          const key = order.id + ':' + (order.wooStore||'');
                          return wooNotesCache[key]?.sellerNote;
                        }
                        return undefined;
                      })();
                      const key = order.id + ':' + (order.wooStore||'');
                      const entry = wooNotesCache[key];
                      const notesArr = entry?.sellerNotes;
                      if ((order.platform==='W') && notesArr && notesArr.length) {
                        const first = notesArr[0];
                        const rest = notesArr.slice(1);
                        return (
                          <div className="text-muted" style={{wordBreak:'break-word', whiteSpace:'pre-line'}}>
                            <span className="text-secondary fw-bold">📑Twoja notatka:</span> {first.text}
                            {rest.length > 0 && (
                              <>
                                {rest.map(n => (
                                  <div key={n.id}>{n.text}</div>
                                ))}
                              </>
                            )}
                          </div>
                        );
                      }
                      const note = order.sellerNote || injected; // fallback
                      if (!note) return null;
                      // Allegro – pokaż etykietę, Woo (pojedyncza) też zachowaj etykietę dla spójności
                      return (
                        <div className="text-muted" style={{wordBreak:'break-word'}}>
                          <span className="text-secondary fw-bold">📑Twoja notatka:</span> {note}
                        </div>
                      );
                    })()}
                    {/* Debug lista notatek usunięta na życzenie – pozostaje tylko finalna notatka sprzedawcy */}
                  </div>
                )}
                {order.totalAmount !== undefined && (
                  <div className="mt-1 pt-1 border-top d-flex justify-content-between align-items-center small" style={{gap:8}}>
                    <span className="fw-bold" title="Kwota całkowita zamówienia">{formatWithPln(order.totalAmount, order.currency || 'PLN')}</span>
                    <span className="d-flex align-items-center gap-1" style={{whiteSpace:'nowrap'}}>
                      <span className={order.isPaid ? 'text-success fw-semibold' : 'text-danger fw-semibold'} title={order.isPaid ? 'Opłacone' : 'Nieopłacone'}>{order.isPaid ? '💸' : '💢'}</span>
                      <span className={order.hasInvoice ? 'fw-bold text-success' : 'text-danger text-decoration-line-through'} title={order.hasInvoice ? 'Faktura dostępna' : 'Brak faktury'}>FV</span>
                    </span>
                    <div className="d-flex align-items-center ms-auto" style={{gap:6}}>
                      {order.platform==='A' && (
                        <>
                          <button
                            className="offer-action-btn primary"
                            style={{ padding:'4px 10px', fontSize:12 }}
                            title={order.hasInvoice ? "Pobierz paragon i fakturę" : "Pobierz paragon"}
                            onClick={() => onDownloadReceipt && onDownloadReceipt(order)}
                          ><span className="icon-emoji">🖨️</span></button>
                          <a className="offer-action-btn danger" style={{ padding:'4px 10px', fontSize:12 }} href={`https://salescenter.allegro.com/ship-with-allegro/swa/create-shipment/${order.id}`} target="_blank" rel="noopener noreferrer" title="Nadaj przesyłkę w Allegro"><span className="icon-emoji">🚚</span></a>
                        </>
                      )}
                      {order.platform==='W' && (
                        <>
                          <button
                            className="offer-action-btn primary"
                            style={{ padding:'4px 10px', fontSize:12 }}
                            title={order.hasInvoice ? "Pobierz paragon (Woo nie wykrywa faktury!!!)" : "Pobierz paragon"}
                            onClick={() => onDownloadReceiptWoo && onDownloadReceiptWoo(order)}
                          ><span className="icon-emoji">🖨️</span></button>
                        </>
                      )}
                      {order.platform==='W' && getWooAdminUrl && (() => {
                        const url = getWooAdminUrl(order.wooStore, order.id);
                        return url ? (
                          <a
                            className="offer-action-btn danger"
                            style={{ padding:'4px 10px', fontSize:12 }}
                            href={url}
                            target="_blank"
                            rel="noopener noreferrer"
                            title="Nadaj przesyłkę w WordPress"
                          >
                            <span className="icon-emoji">🚚</span>
                          </a>
                        ) : null;
                      })()}
                      <span className="text-muted" style={{whiteSpace:'nowrap'}} title="Metoda dostawy">{simplifyDeliveryMethod(order.deliveryMethod)}</span>
                    </div>
                  </div>
                )}
                {(() => {
                  // Dodatkowa czerwona linia: tylko dla Allegro ze zwrotami i gdy są jakieś pozycje zwrócone
                  const perOrder = (order.platform==='A' && returnedOfferIdsByOrder) ? returnedOfferIdsByOrder[order.id] : undefined;
                  const isReturnOrder = order.platform==='A' && (returnedOrderIds?.has(order.id) || false);
                  if (!isReturnOrder || !Array.isArray(order.items)) return null;
                  const isReturnedOffer = (offerId: any) => {
                    if (!perOrder || !offerId) return false;
                    return perOrder instanceof Set ? perOrder.has(offerId) : Array.isArray(perOrder) ? perOrder.includes(offerId) : false;
                  };
                  const nonShip = (order.items || []).filter((it: any) => !it.isShipping);
                  const sumAll = nonShip.reduce((s: number, it: any) => s + (typeof it.totalPrice === 'number' ? it.totalPrice : 0), 0);
                  const sumReturned = nonShip.reduce((s: number, it: any) => s + (isReturnedOffer(it.id) ? (typeof it.totalPrice === 'number' ? it.totalPrice : 0) : 0), 0);
                  if (sumReturned <= 0) return null;
                  const sumLeft = Math.max(0, sumAll - sumReturned);
                  return (
                    <div className="small" style={{ color:'#b00020', marginTop:'-14px' }}>
                      <span className="fw-bold" title="Suma pozostała po zwrocie">{formatWithPln(sumLeft, order.currency || 'PLN')}</span>
                      <span title="Różnica po zwrocie"> ({`-${formatWithPln(sumReturned, order.currency || 'PLN')}`})</span>
                    </div>
                  );
                })()}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
};

function statusLabel(status?: string) {
  if (!status) return '—';
  const s = status.toLowerCase();
  switch (s) {
    case 'new': return 'Nowe';
    case 'pending': return 'Nowe';
    case 'processing': return 'W realizacji';
    case 'ready_for_shipment': return 'W realizacji';
    case 'on-hold': return 'Wstrzymane';
    case 'suspended': return 'Wstrzymane';
    case 'sent': return 'Wysłane';
    case 'completed': return 'Wysłane';
    case 'picked_up': return 'Wysłane';
    case 'ready_for_pickup': return 'Wysłane';
    case 'refunded': return 'Zwrócone';
    case 'returned': return 'Zwrócone';
    case 'cancelled': return 'Anulowane';
    case 'failed': return 'Anulowane';
    default: return s;
  }
}
function statusClass(status?: string) {
  if (!status) return 'text-muted';
  const s = status.toLowerCase();
  if (['new','pending'].includes(s)) return 'text-primary'; // niebieskie: nowe / oczekujące płatności
  if (['processing','ready_for_shipment','on-hold','suspended'].includes(s)) return 'text-warning'; // żółte: w trakcie
  if (['cancelled','failed','refunded','returned'].includes(s)) return 'text-danger'; // czerwone: anulowane / zwrócone / nieudane
  if (['sent','completed','picked_up','ready_for_pickup'].includes(s)) return 'text-success'; // zielone: wysłane / zrealizowane
  return 'text-secondary';
}

export default UnifiedOrders;

function InlineOfferButtons({ offerId, itemName, refresh }: { offerId: string; itemName?: string; refresh: () => Promise<void>; }) {
  const [working, setWorking] = useState<string | null>(null);
  const btnStyle: React.CSSProperties = { padding: '2px 6px', fontSize: 11, lineHeight: 1.1 };
  const endOffer = async () => { try { setWorking('end'); await endOffers([offerId]); } catch(e){ console.error(e);} finally { setWorking(null); refresh(); } };
  const ensureOnePiece = async () => { try { setWorking('one'); await setLastOffers([offerId]); try { await resumeLastOffers([offerId]); } catch{} } catch(e){ console.error(e);} finally { setWorking(null); refresh(); } };
  const phrase = (itemName && itemName.trim().length >= 3) ? itemName : offerId; // fallback do ID jeśli brak sensownej nazwy
  const allegroSearchUrl = phrase ? `https://salescenter.allegro.com/my-assortment?limit=20&publication.status=ACTIVE&sellingMode.format=BUY_NOW&publication.marketplace=allegro-pl&phrase=${encodeURIComponent(phrase)}` : null;
  return (
    <div className="d-flex gap-1">
      {allegroSearchUrl && (
        <a
          className="offer-action-btn danger"
          style={btnStyle}
          href={allegroSearchUrl}
          target="_blank"
          rel="noopener noreferrer"
          title="Wyszukaj ofertę w asortymencie Allegro"
        ><span className="icon-emoji">🅰️</span></a>
      )}
      <button className="offer-action-btn primary" style={btnStyle} title="Ustaw 1. sztukę i wznów, jeśli zakończona" disabled={!!working} onClick={ensureOnePiece}><span className="icon-emoji">1️⃣</span></button>
      <button className="offer-action-btn danger" style={btnStyle} title="Zakończ ofertę" disabled={!!working} onClick={endOffer}><span className="icon-emoji">🅾️</span></button>
    </div>
  );
}

function InlineWooButtons({ store, productId, variationId, itemName, refresh }: { store: 'outdoorowe'|'sklepbastion'; productId?: number; variationId?: number; itemName?: string; refresh: () => Promise<void>; }) {
  const [working, setWorking] = useState<string | null>(null);
  const btnStyle: React.CSSProperties = { padding: '2px 6px', fontSize: 11, lineHeight: 1.1 };
  const allegroSearchUrl = itemName ? `https://salescenter.allegro.com/my-assortment?limit=20&publication.status=ACTIVE&sellingMode.format=BUY_NOW&publication.marketplace=allegro-pl&phrase=${encodeURIComponent(itemName)}` : undefined;
  const ensureOne = async () => {
    if (!productId) return;
    try {
      setWorking('one');
      await setWooOne(store, productId, variationId);
    } catch(e) { console.error(e); }
    finally { setWorking(null); refresh(); }
  };
  const endIt = async () => {
    if (!productId) return;
    try {
      setWorking('end');
      await endWooProduct(store, productId, variationId);
    } catch(e) { console.error(e); }
    finally { setWorking(null); refresh(); }
  };
  return (
    <div className="d-flex gap-1">
      {allegroSearchUrl && (
        <a
          className="offer-action-btn danger"
          style={btnStyle}
          href={allegroSearchUrl}
          target="_blank"
          rel="noopener noreferrer"
          title="Wyszukaj w asortymencie Allegro"
        ><span className="icon-emoji">🅰️</span></a>
      )}
      <button className="offer-action-btn primary" style={btnStyle} title="Ustaw 1. sztukę" disabled={!!working} onClick={ensureOne}><span className="icon-emoji">1️⃣</span></button>
      <button className="offer-action-btn danger" style={btnStyle} title="Ustaw 0. sztuk" disabled={!!working} onClick={endIt}><span className="icon-emoji">🅾️</span></button>
    </div>
  );
}