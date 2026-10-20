0.014999999999999999::bio_release.
0.014999999999999999::bio_fatal.
0.02::nuclear_exchange.
0.14999999999999999::nuclear_fatal.
0.029999999999999999::control_loss.
0.10000000000000001::control_fatal.
p_doom :- bio_release, bio_fatal.
p_doom :- nuclear_exchange, nuclear_fatal.
p_doom :- control_loss, control_fatal.
query(p_doom).
