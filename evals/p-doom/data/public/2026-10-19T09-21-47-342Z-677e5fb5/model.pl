0.050000000000000003::bio_enable.
0.050000000000000003::bio_release.
0.029999999999999999::bio_fatal.
0.025000000000000001::nuclear_event.
0.20000000000000001::nuclear_fatal.
0.02::control_event.
0.029999999999999999::control_fatal.
bio_outbreak :- bio_enable, bio_release.
bio_catastrophe :- bio_outbreak, bio_fatal.
nuclear_catastrophe :- nuclear_event, nuclear_fatal.
control_catastrophe :- control_event, control_fatal.
p_doom :- bio_catastrophe.
p_doom :- nuclear_catastrophe.
p_doom :- control_catastrophe.
query(bio_catastrophe).
query(bio_outbreak).
query(control_catastrophe).
query(nuclear_catastrophe).
query(p_doom).
