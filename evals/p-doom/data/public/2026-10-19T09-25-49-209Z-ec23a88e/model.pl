0.10000000000000001::bio_enable.
0.050000000000000003::bio_spread.
0.10000000000000001::bio_mass.
0.029999999999999999::nuclear_ai_event.
0.14999999999999999::nuclear_mass.
0.014999999999999999::infra_ai_event.
0.050000000000000003::infra_mass.
0.02::control_loss.
0.20000000000000001::control_mass.
bio_outbreak :- bio_enable, bio_spread.
p_doom :- bio_outbreak, bio_mass.
p_doom :- nuclear_ai_event, nuclear_mass.
p_doom :- infra_ai_event, infra_mass.
p_doom :- control_loss, control_mass.
query(bio_outbreak).
query(p_doom).
