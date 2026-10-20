0.75::stakes.
0.040000000000000001::bio_event.
0.029999999999999999::bio_fatal.
0.014999999999999999::nuc_event.
0.34999999999999998::nuc_fatal.
0.01::control_event.
0.17999999999999999::control_fatal.
bio_doom :- stakes, bio_event, bio_fatal.
nuc_doom :- stakes, nuc_event, nuc_fatal.
control_doom :- stakes, control_event, control_fatal.
p_doom :- bio_doom.
p_doom :- nuc_doom.
p_doom :- control_doom.
query(bio_doom).
query(control_doom).
query(nuc_doom).
query(p_doom).
