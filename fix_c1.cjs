const fs = require('fs');

const file = 'src/pages/trip/MapTab.tsx';
let content = fs.readFileSync(file, 'utf8');

// Fix C1: batch all arc adds in a single mutator
const oldCode = `let n = 0
                        for (const id of arc.hitIds) {
                          const m = arcHits.find(h => (h.id as string) === (id as string))
                          if (!m || addedIds.has(m.id as string)) continue
                          recordDnaEvent({ tripId: trip.id, action: 'accept', category: m.category, detourMin: asymmetricDetourMinutes(m, anchors, routePolyline ?? null, MODE_SPEED[trip.transportMode] ?? 40), visitMin: visitMinutesForCategory(m.category) })
                          addPoiToDay(m, dayForKm(m.cumKm))
                          n += 1
                        }
                        suggestionCache.clearMap()
                        setDnaTick(t => t + 1)
                        setAddedIds(prev => {
                          const next = new Set(prev)
                          for (const id of arc.hitIds) next.add(id as string)
                          return next
                        })`;

const newCode = `let n = 0
                        const toAdd: { hit: PlaceHit; dayIndex: number }[] = []
                        for (const id of arc.hitIds) {
                          const m = arcHits.find(h => (h.id as string) === (id as string))
                          if (!m || addedIds.has(m.id as string)) continue
                          toAdd.push({ hit: m, dayIndex: dayForKm(m.cumKm) })
                          n += 1
                        }
                        if (n > 0) {
                          // Fix C1: batch all adds in a single mutator to avoid cloning trip N times
                          applyChange(draft => {
                            for (const { hit, dayIndex } of toAdd) {
                              const day = draft.days.find(d => d.index === dayIndex)!
                              day.stops.push({
                                id: 'pending_' + Math.random().toString(36).slice(2),
                                title: hit.name,
                                category: (hit.category as ItineraryStop['category']) ?? 'sight',
                                lat: hit.latitude,
                                lng: hit.longitude,
                                visitMinutes: visitMinutesForCategory(hit.category) ?? 15,
                                stopType: 'sight',
                                status: 'pending',
                                detourKm: asymmetricDetourMinutes(hit, anchors, routePolyline ?? null, MODE_SPEED[trip.transportMode] ?? 40),
                              })
                              recordDnaEvent({ tripId: trip.id, action: 'accept', category: hit.category, detourMin: asymmetricDetourMinutes(hit, anchors, routePolyline ?? null, MODE_SPEED[trip.transportMode] ?? 40), visitMin: visitMinutesForCategory(hit.category) })
                            }
                          }, 'add_stop', trip.days[0]?.index ?? 0)
                          suggestionCache.clearMap()
                          setDnaTick(t => t + 1)
                          setAddedIds(prev => {
                            const next = new Set(prev)
                            for (const id of arc.hitIds) next.add(id as string)
                            return next
                          })
                          toast(\`"\${arc.label.split(':')[0]}" added (\${n} stops)\`)
                        } else {
                          toast('All of those are already added')
                        }`;

if (!content.includes(oldCode)) {
  console.error('OLD CODE NOT FOUND');
  console.log('Looking for:', JSON.stringify(oldCode.substring(0, 100)));
  process.exit(1);
}

content = content.replace(oldCode, newCode);
fs.writeFileSync(file, content);
console.log('C1 fix applied');